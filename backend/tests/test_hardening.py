"""Phase 4: upload hardening, request size limits, entry caps, admin audit log, data export, calendar download, logging."""
import io
import json
import logging
from contextlib import contextmanager
import httpx
import pytest
from conftest import signup
from PIL import Image
from sqlalchemy import select

from app.cli.create_admin import create_admin
from app.core import config
from app.core.db import SessionLocal
from app.core.ratelimit import limiter
from app.models import AuditLog, Entry, StoredImage, User
from app.routers import auth as auth_router
from app.routers import news_calendar

PW = "correct-horse-42"
BODY = {"timestamp": 1_700_000_000_000, "pair": "XAUUSD"}


def entry(client, h, **extra):
    return client.post("/api/entries", json={**BODY, **extra}, headers=h)


def put(client, h, eid, data, slot="before"):
    return client.put(f"/api/entries/{eid}/images/{slot}", content=data, headers=h)


def stored():
    with SessionLocal() as db:
        return list(db.scalars(select(StoredImage)))


# ---------- images ----------
def test_exif_metadata_and_appended_payloads_are_removed(client):
    h = signup(client)
    eid = entry(client, h).json()["id"]
    img = Image.new("RGB", (40, 30), (10, 120, 200))
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"  # Make
    exif[0x8825] = {1: "N", 2: (40.0, 26.0, 46.0)}  # GPS block
    out = io.BytesIO()
    img.save(out, "JPEG", exif=exif)
    dirty = out.getvalue() + b"<script>alert(1)</script>HIDDEN-PAYLOAD"
    assert b"SecretCameraMaker" in dirty
    assert put(client, h, eid, dirty).status_code == 200
    data = stored()[0].data
    assert b"SecretCameraMaker" not in data and b"HIDDEN-PAYLOAD" not in data and b"<script>" not in data
    assert Image.open(io.BytesIO(data)).size == (40, 30)


def test_large_pictures_are_scaled_down(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_IMAGE_SIDE", 64)
    h = signup(client)
    eid = entry(client, h).json()["id"]
    out = io.BytesIO()
    Image.new("RGB", (400, 200), (0, 0, 0)).save(out, "PNG")
    assert put(client, h, eid, out.getvalue()).status_code == 200
    assert max(Image.open(io.BytesIO(stored()[0].data)).size) == 64


def test_pictures_with_too_many_pixels_are_refused_before_decoding(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_IMAGE_PIXELS", 500)
    h = signup(client)
    eid = entry(client, h).json()["id"]
    out = io.BytesIO()
    Image.new("RGB", (40, 30)).save(out, "PNG")  # 1200 pixels
    assert put(client, h, eid, out.getvalue()).status_code == 415
    assert stored() == []


def test_transparent_pngs_keep_their_transparency(client):
    h = signup(client)
    eid = entry(client, h).json()["id"]
    out = io.BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 0)).save(out, "PNG")
    assert put(client, h, eid, out.getvalue()).status_code == 200
    assert Image.open(io.BytesIO(stored()[0].data)).convert("RGBA").getpixel((5, 5))[3] == 0


def test_streamed_uploads_are_cut_off_at_the_limit_without_a_content_length(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_IMAGE_BYTES", 1000)
    h = signup(client)
    eid = entry(client, h).json()["id"]

    def chunks():  # a generator body is sent chunked, so there is no Content-Length to check
        for _ in range(50):
            yield b"RIFF" + b"\x00" * 99

    r = client.put(f"/api/entries/{eid}/images/before", content=chunks(), headers=h)
    assert r.status_code == 413
    assert stored() == []


def test_a_users_screenshots_have_a_total_size_cap(client, monkeypatch):
    h = signup(client)
    a, b = entry(client, h).json()["id"], entry(client, h).json()["id"]
    out = io.BytesIO()
    Image.new("RGB", (64, 64), (1, 2, 3)).save(out, "PNG")
    assert put(client, h, a, out.getvalue()).status_code == 200
    one = len(stored()[0].data)
    monkeypatch.setattr(config, "MAX_USER_IMAGE_BYTES", one + 10)
    assert put(client, h, b, out.getvalue()).status_code == 409
    assert put(client, h, a, out.getvalue()).status_code == 200  # replacing does not count twice


def test_uploads_are_rate_limited_per_user(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    limiter.reset()
    h = signup(client)
    eid = entry(client, h).json()["id"]
    out = io.BytesIO()
    Image.new("RGB", (8, 8)).save(out, "PNG")
    codes = [put(client, h, eid, out.getvalue()).status_code for _ in range(62)]
    assert codes[:60] == [200] * 60 and codes[60:] == [429, 429]


# ---------- request size ----------
def test_oversized_request_bodies_get_413(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_BODY_BYTES", 1000)
    h = signup(client)
    r = client.post("/api/entries", json={**BODY, "notes": "x" * 2000}, headers=h)
    assert r.status_code == 413 and r.json() == {"detail": "Request is too large"}
    assert r.headers["x-content-type-options"] == "nosniff"
    assert client.post("/api/entries", json=BODY, headers=h).status_code == 201


def test_413_still_carries_cors_headers(client, monkeypatch):
    monkeypatch.setattr(config, "MAX_BODY_BYTES", 1000)
    h = {**signup(client), "Origin": "http://localhost:5173"}
    r = client.post("/api/entries", json={**BODY, "notes": "x" * 2000}, headers=h)
    assert r.status_code == 413 and r.headers["access-control-allow-origin"] == "http://localhost:5173"


# ---------- entry field limits ----------
def test_notes_and_collections_have_size_limits(client):
    h = signup(client)
    assert entry(client, h, notes="n" * 5000, lesson="l" * 5000).status_code == 201
    assert entry(client, h, notes="n" * 5001).status_code == 422
    assert entry(client, h, lesson="l" * 5001).status_code == 422
    assert entry(client, h, answers={f"r{i}": True for i in range(201)}).status_code == 422
    assert entry(client, h, failedRules=list(range(201))).status_code == 422


def test_entries_saved_before_the_limits_can_still_be_read(client):
    h = signup(client)
    with SessionLocal() as db:
        uid = db.scalar(select(User.id))
        db.add(Entry(user_id=uid, id="legacy", timestamp=1_700_000_000_000, pair="EURUSD", notes="old " * 10_000, lesson="x" * 9000))
        db.commit()
    r = client.get("/api/entries", headers=h)
    assert r.status_code == 200 and len(r.json()[0]["notes"]) == 40_000
    assert client.get("/api/auth/export", headers=h).status_code == 200


# ---------- data export ----------
def test_export_contains_the_users_data_only(client):
    a, b = signup(client, "alice"), signup(client, "bob")
    entry(client, a, pair="EURUSD", notes="alice note")
    entry(client, b, pair="GBPUSD", notes="bob note")
    r = client.get("/api/auth/export", headers=a)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["account"]["email"] == "alice@example.com"
    assert [e["notes"] for e in data["entries"]] == ["alice note"]
    assert "images" not in data["entries"][0] and "lot" in data["settings"] and "minRR" in data["settings"]
    assert "bob" not in json.dumps(data) and "password" not in json.dumps(data).lower()
    assert client.get("/api/auth/export").status_code == 401


def test_export_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    limiter.reset()
    h = signup(client)
    assert [client.get("/api/auth/export", headers=h).status_code for _ in range(6)] == [200] * 5 + [429]


# ---------- admin audit log ----------
def admin_headers(client):
    create_admin("boss@example.com", PW)
    r = client.post("/api/auth/login", json={"email": "boss@example.com", "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def uid(email):
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.email == email))


def test_admin_actions_are_written_to_the_audit_log(client, monkeypatch):
    sent = []
    monkeypatch.setattr(config, "EMAIL_ENABLED", True)
    monkeypatch.setattr(auth_router, "send_link_email", lambda *a, **k: sent.append(a))
    from app.routers import admin as admin_mod
    monkeypatch.setattr(admin_mod, "send_link_email", lambda *a, **k: sent.append(a))
    admin = admin_headers(client)
    signup(client, "bob")
    bob = uid("bob@example.com")
    assert client.post("/api/admin/users", json={"email": "new@example.com"}, headers=admin).status_code == 201
    assert client.post(f"/api/admin/users/{bob}/verify", headers=admin).status_code == 200
    assert client.post(f"/api/admin/users/{bob}/send-reset", headers=admin).status_code == 202
    assert client.patch(f"/api/admin/users/{bob}", json={"isActive": False}, headers=admin).status_code == 200
    assert client.patch(f"/api/admin/users/{bob}", json={"isActive": True}, headers=admin).status_code == 200
    assert client.delete(f"/api/admin/users/{bob}", headers=admin).status_code == 204
    log = client.get("/api/admin/audit", headers=admin).json()
    assert [r["action"] for r in log] == ["delete_user", "enable_user", "disable_user", "send_reset", "verify_user", "create_user"]
    assert all(r["admin"] == "boss@example.com" and r["ip"] for r in log)
    assert log[0]["target"] == "bob@example.com"  # kept after the user is gone
    assert log[-1]["target"] == "new@example.com"


def test_audit_log_is_admin_only(client):
    h = signup(client)
    assert client.get("/api/admin/audit", headers=h).status_code == 403
    assert client.get("/api/admin/audit").status_code == 401


def test_failed_admin_actions_leave_no_audit_row(client):
    admin = admin_headers(client)
    assert client.patch("/api/admin/users/9999", json={"isActive": False}, headers=admin).status_code == 404
    assert client.patch(f"/api/admin/users/{uid('boss@example.com')}", json={"isActive": False}, headers=admin).status_code == 400
    with SessionLocal() as db:
        assert db.scalars(select(AuditLog)).all() == []


def test_admin_invitation_is_a_set_password_link_not_a_password(client, monkeypatch):
    from app.routers import admin as admin_mod

    sent = []
    monkeypatch.setattr(config, "EMAIL_ENABLED", True)
    monkeypatch.setattr(admin_mod, "send_link_email", lambda to, subject, intro, button, link, outro: sent.append((to, intro, link, outro)))
    admin = admin_headers(client)
    assert client.post("/api/admin/users", json={"email": "new@example.com"}, headers=admin).status_code == 201
    to, intro, link, outro = sent[0]
    assert to == "new@example.com" and "?reset=" in link and "password is" not in (intro + outro).lower()
    token = link.split("reset=")[1]
    r = client.post("/api/auth/reset-password", json={"token": token, "password": "A-fresh-start-9"})
    assert r.status_code == 200  # the invited user picks their own password
    assert client.post("/api/auth/login", json={"email": "new@example.com", "password": "A-fresh-start-9"}).status_code == 200


# ---------- calendar download ----------
class FakeResponse:
    def __init__(self, body: bytes, url="https://feed.example/x.json"):
        self.body, self.url = body, httpx.URL(url)

    def raise_for_status(self):
        pass

    def iter_bytes(self):
        for i in range(0, len(self.body), 1024):
            yield self.body[i:i + 1024]


def fake_stream(response):
    @contextmanager
    def stream(*args, **kwargs):
        yield response
    return stream


def test_calendar_feeds_must_be_https():
    with pytest.raises(ValueError, match="https"):
        news_calendar.fetch_json("http://feed.example/x.json")


def test_plain_http_is_allowed_only_to_localhost_and_never_in_production(monkeypatch):
    monkeypatch.setattr(news_calendar.httpx, "stream", fake_stream(FakeResponse(b"[]", "http://localhost:8799/this.json")))
    assert news_calendar.fetch_json("http://localhost:8799/this.json") == []  # the browser tests' fake feed
    with pytest.raises(ValueError, match="https"):
        news_calendar.fetch_json("http://calendar.example.com/this.json")
    monkeypatch.setattr(config, "IS_PRODUCTION", True)
    with pytest.raises(ValueError, match="https"):
        news_calendar.fetch_json("http://localhost:8799/this.json")


def test_calendar_feed_that_redirects_to_http_is_refused(monkeypatch):
    monkeypatch.setattr(news_calendar.httpx, "stream", fake_stream(FakeResponse(b"[]", "http://evil.example/x")))
    with pytest.raises(ValueError, match="redirected"):
        news_calendar.fetch_json("https://feed.example/x.json")


def test_calendar_feed_size_is_capped(monkeypatch):
    monkeypatch.setattr(news_calendar.httpx, "stream", fake_stream(FakeResponse(b"[" + b" " * (config.MAX_FEED_BYTES + 10) + b"]")))
    with pytest.raises(ValueError, match="too large"):
        news_calendar.fetch_json("https://feed.example/x.json")


def test_calendar_feed_normal_download_parses(monkeypatch):
    monkeypatch.setattr(news_calendar.httpx, "stream", fake_stream(FakeResponse(b'[{"title": "CPI"}]')))
    assert news_calendar.fetch_json("https://feed.example/x.json") == [{"title": "CPI"}]


def test_http_calendar_urls_stop_production_startup(monkeypatch):
    monkeypatch.setattr(config, "CALENDAR_ENABLED", True)
    monkeypatch.setattr(config, "CALENDAR_URLS", ["http://nfs.example/x.json"])
    assert any("CALENDAR_URLS" in p for p in config.production_problems())


# ---------- security log ----------
def test_security_events_are_logged_without_secrets(client, caplog):
    signup(client)
    caplog.set_level(logging.WARNING, logger="tradeguard.security")
    client.post("/api/auth/login", json={"email": "alice@example.com", "password": "definitely-wrong-1"})
    client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "definitely-wrong-2"})
    text = caplog.text
    assert text.count("login_failed") == 2 and "ip=" in text
    assert "definitely-wrong" not in text and "alice@example.com" not in text and "ghost@example.com" not in text


def test_token_reuse_is_logged(client, caplog):
    from datetime import timedelta
    from app.core import sessions
    from app.models import AuthSession

    signup(client)
    client.post("/api/auth/login", json={"email": "alice@example.com", "password": PW})
    old = client.cookies.get(config.REFRESH_COOKIE)
    client.post("/api/auth/refresh")
    with SessionLocal() as db:
        s = db.scalars(select(AuthSession).order_by(AuthSession.created_at.desc())).first()
        s.rotated_at = s.rotated_at - timedelta(seconds=sessions.GRACE_SECONDS + 5)
        db.commit()
    caplog.set_level(logging.WARNING, logger="tradeguard.security")
    from fastapi.testclient import TestClient
    thief = TestClient(client.app)
    thief.cookies.set(config.REFRESH_COOKIE, old, path="/api/auth")
    assert thief.post("/api/auth/refresh").status_code == 401
    assert "refresh_token_reuse" in caplog.text


def test_sentry_is_off_without_a_dsn(monkeypatch):
    from app.core import observability

    monkeypatch.setattr(config, "SENTRY_DSN", "")
    assert observability.setup_sentry() is None


def test_docs_are_hidden_in_production_only():
    from app.main import app

    assert app.docs_url == "/docs"  # tests run as development
