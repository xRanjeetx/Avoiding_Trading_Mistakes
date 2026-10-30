"""Login sessions: short-lived access token + rotating HttpOnly refresh cookie, revocable on the server."""
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select

from app.core import config, sessions
from app.core.db import SessionLocal
from app.models import AuthSession, User
from app.routers import auth as auth_router
from conftest import signup

PW = "correct-horse-42"
COOKIE = config.REFRESH_COOKIE


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def login(client, email="alice@example.com", password=PW):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def rows():
    with SessionLocal() as db:
        return db.scalars(select(AuthSession).order_by(AuthSession.created_at)).all()


def latest(db):
    """The newest session. signup() and login() each start one, so a test that logs in works on the last."""
    return db.scalars(select(AuthSession).order_by(AuthSession.created_at.desc())).first()


def fresh_client(client):
    """A second browser: same app, no cookies."""
    from fastapi.testclient import TestClient
    return TestClient(client.app)


def test_login_sets_an_httponly_cookie_scoped_to_auth_and_a_short_access_token(client):
    signup(client)
    r = login(client)
    cookie = r.headers["set-cookie"]
    assert cookie.startswith(f"{COOKIE}=") and "HttpOnly" in cookie and "Path=/api/auth" in cookie
    assert "samesite=lax" in cookie.lower()
    claims = jwt.decode(r.json()["access_token"], config.SECRET_KEY, algorithms=["HS256"])
    assert 0 < claims["exp"] - datetime.now(timezone.utc).timestamp() <= config.ACCESS_MINUTES * 60
    assert claims["sid"] == rows()[-1].id


def test_the_refresh_token_is_stored_hashed(client):
    signup(client)
    raw = login(client).cookies.get(COOKIE)
    stored = rows()[-1]
    assert raw and raw != stored.token_hash and stored.token_hash == sessions.hash_token(raw)


def test_refresh_gives_a_new_access_token_and_rotates_the_cookie(client):
    signup(client)
    first = login(client)
    old_cookie = client.cookies.get(COOKIE)
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200 and r.json()["email"] == "alice@example.com"
    assert client.get("/api/entries", headers=bearer(r.json()["access_token"])).status_code == 200
    assert client.cookies.get(COOKIE) != old_cookie
    assert first.json()["access_token"]  # the earlier one keeps working until it expires
    assert client.get("/api/entries", headers=bearer(first.json()["access_token"])).status_code == 200


def test_refresh_without_a_cookie_is_401(client):
    assert client.post("/api/auth/refresh").status_code == 401


def test_a_second_tab_with_the_previous_cookie_is_tolerated_briefly(client):
    signup(client)
    login(client)
    old = client.cookies.get(COOKIE)
    assert client.post("/api/auth/refresh").status_code == 200  # tab 1 rotates
    tab2 = fresh_client(client)
    tab2.cookies.set(COOKIE, old, path="/api/auth")
    r = tab2.post("/api/auth/refresh")  # tab 2 still sends the old one, inside the grace period
    assert r.status_code == 200 and "set-cookie" not in r.headers
    assert not rows()[-1].revoked_at


def test_replaying_an_old_refresh_token_after_the_grace_period_kills_the_session(client):
    signup(client)
    login(client)
    old = client.cookies.get(COOKIE)
    client.post("/api/auth/refresh")
    with SessionLocal() as db:
        s = latest(db)
        s.rotated_at = s.rotated_at - timedelta(seconds=sessions.GRACE_SECONDS + 5)
        db.commit()
    thief = fresh_client(client)
    thief.cookies.set(COOKIE, old, path="/api/auth")
    assert thief.post("/api/auth/refresh").status_code == 401
    assert rows()[-1].revoked_at  # the real owner's session is revoked too
    assert client.post("/api/auth/refresh").status_code == 401


def test_logout_revokes_the_session_at_once(client):
    signup(client)
    token = login(client).json()["access_token"]
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/entries", headers=bearer(token)).status_code == 401  # not just when it expires
    assert client.post("/api/auth/refresh").status_code == 401
    assert rows()[-1].revoked_at


def test_logout_with_a_stale_cookie_still_succeeds(client):
    client.cookies.set(COOKIE, "garbage", path="/api/auth")
    assert client.post("/api/auth/logout").status_code == 204


def test_logout_all_ends_every_device(client):
    signup(client)
    phone = fresh_client(client)
    token = login(phone).json()["access_token"]
    laptop = login(client).json()["access_token"]
    assert client.post("/api/auth/logout-all", headers=bearer(laptop)).status_code == 204
    assert phone.get("/api/entries", headers=bearer(token)).status_code == 401
    assert phone.post("/api/auth/refresh").status_code == 401
    assert all(s.revoked_at for s in rows())


def test_password_reset_signs_out_every_device(client, monkeypatch):
    sent = []
    monkeypatch.setattr(auth_router, "send_link_email", lambda *a, **k: sent.append(a))
    signup(client)
    old_token = login(client).json()["access_token"]
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    reset = fresh_client(client)
    r = reset.post("/api/auth/reset-password", json={"token": sent[0][4].split("reset=")[1], "password": "A-fresh-start-9"})
    assert r.status_code == 200
    assert client.get("/api/entries", headers=bearer(old_token)).status_code == 401
    assert client.post("/api/auth/refresh").status_code == 401
    assert reset.get("/api/entries", headers=bearer(r.json()["access_token"])).status_code == 200  # the new login works


def test_disabling_a_user_signs_them_out_immediately(client):
    from app.cli.create_admin import create_admin

    create_admin("boss@example.com", PW)
    signup(client, "bob")
    bob = login(client, "bob@example.com")
    admin = fresh_client(client)
    admin_token = login(admin, "boss@example.com").json()["access_token"]
    assert client.get("/api/auth/me", headers=bearer(bob.json()["access_token"])).status_code == 200
    with SessionLocal() as db:
        bob_id = db.scalar(select(User.id).where(User.email == "bob@example.com"))
    assert admin.patch(f"/api/admin/users/{bob_id}", json={"isActive": False}, headers=bearer(admin_token)).status_code == 200
    assert client.get("/api/entries", headers=bearer(bob.json()["access_token"])).status_code in (401, 403)
    assert client.post("/api/auth/refresh").status_code == 401


def test_expired_sessions_cannot_refresh_or_authenticate(client):
    signup(client)
    token = login(client).json()["access_token"]
    with SessionLocal() as db:
        s = latest(db)
        s.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
        db.commit()
    assert client.get("/api/entries", headers=bearer(token)).status_code == 401
    assert client.post("/api/auth/refresh").status_code == 401


def test_sessions_cannot_outlive_the_absolute_limit(client):
    signup(client)
    login(client)
    with SessionLocal() as db:
        s = latest(db)
        s.created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=config.SESSION_MAX_DAYS - 1)
        sid = s.id
        db.commit()
    assert client.post("/api/auth/refresh").status_code == 200
    with SessionLocal() as db:
        assert db.get(AuthSession, sid).expires_at <= datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=2)


def test_old_style_tokens_without_a_session_are_rejected(client):
    signup(client)
    with SessionLocal() as db:
        uid = db.scalar(select(User.id))
    legacy = jwt.encode({"sub": str(uid), "exp": datetime.now(timezone.utc) + timedelta(days=5)}, config.SECRET_KEY, algorithm="HS256")
    assert client.get("/api/entries", headers=bearer(legacy)).status_code == 401
    other = jwt.encode({"sub": str(uid), "sid": "f" * 32, "exp": datetime.now(timezone.utc) + timedelta(days=5)}, config.SECRET_KEY, algorithm="HS256")
    assert client.get("/api/entries", headers=bearer(other)).status_code == 401  # a session id that does not exist


def test_a_session_cannot_be_used_for_a_different_user(client):
    signup(client, "alice")
    signup(client, "bob")
    with SessionLocal() as db:
        alice, bob = db.scalars(select(User).order_by(User.id)).all()
        sid = db.scalar(select(AuthSession.id).where(AuthSession.user_id == alice.id))
        bob_id = bob.id
    forged = jwt.encode({"sub": str(bob_id), "sid": sid, "exp": datetime.now(timezone.utc) + timedelta(minutes=5)}, config.SECRET_KEY, algorithm="HS256")
    assert client.get("/api/entries", headers=bearer(forged)).status_code == 401


def test_refresh_and_logout_refuse_other_sites(client):
    signup(client)
    login(client)
    evil = {"Origin": "https://evil.example"}
    assert client.post("/api/auth/refresh", headers=evil).status_code == 403
    assert client.post("/api/auth/logout", headers=evil).status_code == 403
    assert client.post("/api/auth/refresh", headers={"Origin": "http://localhost:5173"}).status_code == 200
    assert not rows()[-1].revoked_at


def test_cookie_flags_for_production(client, monkeypatch):
    monkeypatch.setattr(config, "COOKIE_SECURE", True)
    monkeypatch.setattr(config, "COOKIE_SAMESITE", "none")
    signup(client)
    cookie = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PW}).headers["set-cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie and "samesite=none" in cookie.lower()


def test_each_user_keeps_a_limited_number_of_sessions(client):
    signup(client)
    for _ in range(sessions.MAX_SESSIONS_PER_USER + 3):
        login(client)
    live = [s for s in rows() if not s.revoked_at]
    assert len(live) == sessions.MAX_SESSIONS_PER_USER


def test_deleting_the_account_removes_its_sessions(client):
    signup(client)
    token = login(client).json()["access_token"]
    assert client.post("/api/auth/delete-account", json={"password": PW}, headers=bearer(token)).status_code == 204
    assert rows() == []


def test_unverified_user_cannot_refresh_when_verification_is_required(client, monkeypatch):
    signup(client)
    login(client)
    monkeypatch.setattr(config, "REQUIRE_EMAIL_VERIFICATION", True)
    with SessionLocal() as db:
        u = db.scalars(select(User)).one()
        u.email_verified = False
        db.commit()
    assert client.post("/api/auth/refresh").status_code == 401
