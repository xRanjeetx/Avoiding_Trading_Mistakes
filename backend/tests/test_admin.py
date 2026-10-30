import pytest
from sqlalchemy import func, select

from app.routers import admin as admin_mod
from app.routers import auth
from app.cli.create_admin import create_admin
from app.core.db import SessionLocal
from app.models import Entry, User, UserSettings
from conftest import signup

ADMIN_PATHS = [
    ("get", "/api/admin/overview"),
    ("get", "/api/admin/users"),
    ("get", "/api/admin/growth"),
    ("post", "/api/admin/users"),
    ("patch", "/api/admin/users/1"),
    ("delete", "/api/admin/users/1"),
    ("post", "/api/admin/users/1/verify"),
    ("post", "/api/admin/users/1/send-reset"),
]


def signup_admin(client, name="admin"):
    create_admin(f"{name}@example.com", "password123")
    r = client.post("/api/auth/login", json={"email": f"{name}@example.com", "password": "password123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def user_id(email):
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.email == email))


def add_entry(headers, client, **kw):
    body = {"timestamp": 1_700_000_000_000, "pair": "EURUSD", "notes": "SECRET NOTE", "lesson": "SECRET LESSON", **kw}
    assert client.post("/api/entries", json=body, headers=headers).status_code == 201


@pytest.mark.parametrize("method,path", ADMIN_PATHS)
def test_admin_routes_reject_anonymous_and_non_admin(client, method, path):
    body = {"isActive": False}
    assert client.request(method, path, json=body).status_code == 401
    headers = signup(client, "bob")
    assert client.request(method, path, json=body, headers=headers).status_code == 403








def test_users_list_has_stats_but_no_entry_content(client):
    admin = signup_admin(client)
    bob = signup(client, "bob")
    add_entry(bob, client, result="tp", pnl=10.0)
    add_entry(bob, client, timestamp=1_700_000_100_000, result="sl", pnl=-5.0)
    r = client.get("/api/admin/users", headers=admin)
    assert r.status_code == 200
    assert "SECRET" not in r.text
    row = next(u for u in r.json()["items"] if u["email"] == "bob@example.com")
    assert (row["entries"], row["closedTrades"], row["winRate"], row["lastEntryAt"]) == (2, 2, 50, 1_700_000_100_000)
    assert row["isActive"] and not row["isAdmin"]
    empty = client.get("/api/admin/users?q=nomatch", headers=admin).json()
    assert empty["items"] == [] and empty["total"] == 0 and empty["pages"] == 1


def test_users_list_is_paginated_newest_first(client):
    admin = signup_admin(client)
    for i in range(11):
        signup(client, f"user{i:02d}")  # 12 users in all with the admin
    page = lambda n, **kw: client.get("/api/admin/users", params={"page": n, "pageSize": 5, **kw}, headers=admin).json()  # noqa: E731
    p1, p2, p3 = page(1), page(2), page(3)
    assert (p1["total"], p1["pages"], p1["page"], p1["pageSize"]) == (12, 3, 1, 5)
    assert [u["email"] for u in p1["items"]][0] == "user10@example.com"  # newest first
    assert len(p1["items"]) == 5 and len(p2["items"]) == 5 and len(p3["items"]) == 2
    seen = [u["id"] for p in (p1, p2, p3) for u in p["items"]]
    assert len(set(seen)) == 12  # no user twice, none missing
    assert page(99)["page"] == 3 and len(page(99)["items"]) == 2  # past the end -> last page
    search = page(1, q="user0")
    assert search["total"] == 10 and search["pages"] == 2
    bad = client.get("/api/admin/users?pageSize=1000", headers=admin)
    assert bad.status_code == 422 and client.get("/api/admin/users?page=0", headers=admin).status_code == 422


def test_overview_counts(client):
    admin = signup_admin(client)
    signup(client, "bob")
    data = client.get("/api/admin/overview", headers=admin).json()
    assert data["totalUsers"] == 2 and data["verifiedUsers"] == 2 and data["disabledUsers"] == 0
    assert data["newLast7Days"] == 2


def test_disable_blocks_login_and_existing_token(client):
    admin = signup_admin(client)
    bob = signup(client, "bob")
    bid = user_id("bob@example.com")
    assert client.patch(f"/api/admin/users/{bid}", json={"isActive": False}, headers=admin).status_code == 200
    assert client.get("/api/entries", headers=bob).status_code == 403
    login = client.post("/api/auth/login", json={"email": "bob@example.com", "password": "password123"})
    assert login.status_code == 403
    assert client.patch(f"/api/admin/users/{bid}", json={"isActive": True}, headers=admin).status_code == 200
    assert client.get("/api/entries", headers=bob).status_code == 200


def test_delete_user_removes_their_data(client):
    admin = signup_admin(client)
    bob = signup(client, "bob")
    add_entry(bob, client)
    bid = user_id("bob@example.com")
    assert client.delete(f"/api/admin/users/{bid}", headers=admin).status_code == 204
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Entry)) == 0
        assert db.scalar(select(func.count()).select_from(UserSettings).where(UserSettings.user_id == bid)) == 0
        assert db.get(User, bid) is None
    assert client.delete(f"/api/admin/users/{bid}", headers=admin).status_code == 404


def test_admin_cannot_act_on_self_or_admins(client):
    admin = signup_admin(client)
    aid = user_id("admin@example.com")
    assert client.patch(f"/api/admin/users/{aid}", json={"isActive": False}, headers=admin).status_code == 400
    assert client.delete(f"/api/admin/users/{aid}", headers=admin).status_code == 400
    signup_admin(client, "boss")
    bid = user_id("boss@example.com")
    assert client.delete(f"/api/admin/users/{bid}", headers=admin).status_code == 400


def test_force_verify_and_send_reset(client, monkeypatch):
    sent = []
    monkeypatch.setattr(auth, "send_link_email", lambda to, subject, intro, button, link, outro: sent.append((to, link)))
    admin = signup_admin(client)
    signup(client, "bob")
    bid = user_id("bob@example.com")
    with SessionLocal() as db:
        db.get(User, bid).email_verified = False
        db.commit()
    assert client.post(f"/api/admin/users/{bid}/verify", headers=admin).status_code == 200
    with SessionLocal() as db:
        assert db.get(User, bid).email_verified is True
    assert client.post(f"/api/admin/users/{bid}/send-reset", headers=admin).status_code == 202
    assert sent and sent[0][0] == "bob@example.com" and "?reset=" in sent[0][1]
    assert client.post("/api/admin/users/9999/verify", headers=admin).status_code == 404


def test_admin_creates_user_who_can_log_in_with_emailed_password(client, monkeypatch):
    sent = []
    monkeypatch.setattr(admin_mod.config, "EMAIL_ENABLED", True)
    monkeypatch.setattr(admin_mod, "send_link_email", lambda to, subject, intro, button, link, outro: sent.append((to, intro)))
    admin = signup_admin(client)
    r = client.post("/api/admin/users", json={"email": "New@Example.com"}, headers=admin)
    assert r.status_code == 201, r.text
    assert len(sent) == 1 and sent[0][0] == "new@example.com"
    password = sent[0][1].split("<b>")[1].split("</b>")[0]
    login = client.post("/api/auth/login", json={"email": "new@example.com", "password": password})
    assert login.status_code == 200  # created verified, so no verification step
    assert client.post("/api/admin/users", json={"email": "new@example.com"}, headers=admin).status_code == 409


def test_admin_create_user_needs_email_configured(client, monkeypatch):
    monkeypatch.setattr(admin_mod.config, "EMAIL_ENABLED", False)
    admin = signup_admin(client)
    assert client.post("/api/admin/users", json={"email": "x@example.com"}, headers=admin).status_code == 503
    assert user_id("x@example.com") is None


def test_create_admin_logs_in_as_admin_and_promotes_existing(client):
    headers = signup(client, "bob")
    assert client.get("/api/auth/me", headers=headers).json() == {"email": "bob@example.com", "isAdmin": False}
    assert client.get("/api/admin/overview", headers=headers).status_code == 403
    assert create_admin("bob@example.com", "newpassword1") == "promoted"
    login = client.post("/api/auth/login", json={"email": "bob@example.com", "password": "newpassword1"})
    assert login.json()["is_admin"] is True
    h = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/api/auth/me", headers=h).json()["isAdmin"] is True
    assert client.get("/api/admin/overview", headers=h).status_code == 200
    assert create_admin("fresh@example.com", "password123") == "created"


def test_growth_counts_signups_and_active_users_per_day(client):
    import time
    admin = signup_admin(client)
    bob = signup(client, "bob")
    carol = signup(client, "carol")
    now = int(time.time() * 1000)
    add_entry(bob, client, timestamp=now)
    add_entry(bob, client, timestamp=now - 1000)  # same user twice counts once
    add_entry(carol, client, timestamp=now)
    add_entry(carol, client, timestamp=now - 3 * 86_400_000)
    r = client.get("/api/admin/growth?days=7", headers=admin)
    assert r.status_code == 200
    days = r.json()["days"]
    assert len(days) == 7 and days == sorted(days, key=lambda d: d["date"])
    assert days[-1]["signups"] == 3 and sum(d["signups"] for d in days) == 3
    assert days[-1]["active"] == 2 and days[-4]["active"] == 1
    assert client.get("/api/admin/growth?days=3", headers=admin).status_code == 422
    assert "SECRET" not in r.text
