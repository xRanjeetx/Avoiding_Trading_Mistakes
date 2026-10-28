import pytest
from sqlalchemy import func, select

from app import main
from app.create_admin import create_admin
from app.db import SessionLocal
from app.models import Entry, User, UserSettings
from conftest import signup

ADMIN_PATHS = [
    ("get", "/api/admin/overview"),
    ("get", "/api/admin/users"),
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
    row = next(u for u in r.json() if u["email"] == "bob@example.com")
    assert (row["entries"], row["closedTrades"], row["winRate"], row["lastEntryAt"]) == (2, 2, 50, 1_700_000_100_000)
    assert row["isActive"] and not row["isAdmin"]
    assert client.get("/api/admin/users?q=nomatch", headers=admin).json() == []


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
    monkeypatch.setattr(main, "send_link_email", lambda to, subject, intro, button, link, outro: sent.append((to, link)))
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
