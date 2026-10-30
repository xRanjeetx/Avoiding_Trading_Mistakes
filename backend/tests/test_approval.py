"""New sign-ups wait for an admin to approve them (config.REQUIRE_APPROVAL)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.cli.create_admin import create_admin
from app.core import config
from app.core.db import SessionLocal
from app.models import AuditLog, User
from app.routers import admin as admin_mod
from app.routers import auth as auth_router

PW = "correct-horse-42"


@pytest.fixture()
def mails(monkeypatch):
    sent = []
    monkeypatch.setattr(auth_router, "send_link_email", lambda *a, **k: sent.append(a))
    monkeypatch.setattr(admin_mod, "send_link_email", lambda *a, **k: sent.append(a))
    return sent


@pytest.fixture()
def approval(monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_APPROVAL", True)


def register(client, name="bob"):
    return client.post("/api/auth/register", json={"email": f"{name}@example.com", "password": PW})


def login(client, name="bob"):
    return client.post("/api/auth/login", json={"email": f"{name}@example.com", "password": PW})


def admin(client):
    create_admin("boss@example.com", PW)
    r = TestClient(client.app).post("/api/auth/login", json={"email": "boss@example.com", "password": PW})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def uid(name="bob"):
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.email == f"{name}@example.com"))


def row(name="bob"):
    with SessionLocal() as db:
        return db.scalar(select(User).where(User.email == f"{name}@example.com"))


# ---------- without email verification (local setup) ----------
def test_signup_waits_for_approval_and_cannot_log_in(client, approval, mails):
    h = admin(client)
    r = register(client)
    assert r.status_code == 201 and r.json()["pending_approval"] is True and not r.json()["access_token"]
    assert config.REFRESH_COOKIE not in client.cookies
    blocked = login(client)
    assert blocked.status_code == 403 and "waiting for admin approval" in blocked.json()["detail"]
    assert row().approved is False
    pending = client.get("/api/admin/pending", headers=h).json()
    assert [p["email"] for p in pending] == ["bob@example.com"]
    assert any(m[0] == "boss@example.com" and "waiting for approval" in m[1] for m in mails)  # the admin was told


def test_approving_lets_them_in_and_emails_them(client, approval, mails):
    h = admin(client)
    register(client)
    assert client.post(f"/api/admin/users/{uid()}/approve", headers=h).status_code == 200
    ok = login(client)
    assert ok.status_code == 200 and ok.json()["access_token"]
    assert client.get("/api/entries", headers={"Authorization": f"Bearer {ok.json()['access_token']}"}).status_code == 200
    assert any(m[0] == "bob@example.com" and "approved" in m[1].lower() for m in mails)
    assert client.get("/api/admin/pending", headers=h).json() == []
    assert client.post(f"/api/admin/users/{uid()}/approve", headers=h).status_code == 200  # again: harmless
    with SessionLocal() as db:
        assert [a.action for a in db.scalars(select(AuditLog))] == ["approve_user"]  # the repeat is not logged twice


def test_rejecting_removes_the_request(client, approval, mails):
    h = admin(client)
    register(client)
    assert client.post(f"/api/admin/users/{uid()}/reject", headers=h).status_code == 204
    assert row() is None and client.get("/api/admin/pending", headers=h).json() == []
    assert login(client).status_code == 401
    with SessionLocal() as db:
        a = db.scalars(select(AuditLog)).one()
        assert (a.action, a.target_email) == ("reject_user", "bob@example.com")
    assert register(client).status_code == 201  # they may apply again


def test_reject_is_only_for_unapproved_accounts(client, approval, mails):
    h = admin(client)
    register(client)
    client.post(f"/api/admin/users/{uid()}/approve", headers=h)
    r = client.post(f"/api/admin/users/{uid()}/reject", headers=h)
    assert r.status_code == 400 and row() is not None


def test_only_admins_can_approve_or_reject(client, approval, mails):
    admin(client)
    register(client, "bob")
    register(client, "eve")
    assert client.post(f"/api/admin/users/{uid('bob')}/approve").status_code == 401
    with SessionLocal() as db:
        db.get(User, uid("eve")).approved = True
        db.commit()
    eve = login(client, "eve").json()["access_token"]
    h = {"Authorization": f"Bearer {eve}"}
    assert client.post(f"/api/admin/users/{uid('bob')}/approve", headers=h).status_code == 403
    assert client.post(f"/api/admin/users/{uid('bob')}/reject", headers=h).status_code == 403
    assert client.get("/api/admin/pending", headers=h).status_code == 403
    assert row("bob").approved is False


def test_admins_cannot_be_approved_or_rejected_through_these_endpoints(client, approval, mails):
    h = admin(client)
    me = uid("boss")
    assert client.post(f"/api/admin/users/{me}/reject", headers=h).status_code == 400
    assert row("boss").approved is True


# ---------- with email verification (production setup) ----------
def test_verified_email_still_needs_approval(client, approval, mails, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_EMAIL_VERIFICATION", True)
    h = admin(client)
    r = register(client)
    assert r.json()["verification_sent"] is True and r.json()["pending_approval"] is True
    verify_mail = next(m for m in mails if m[0] == "bob@example.com")
    assert not any(m[0] == "boss@example.com" for m in mails)  # not asked to approve before the email is verified
    assert client.get("/api/admin/pending", headers=h).json() == []
    v = client.post("/api/auth/verify-email", json={"token": verify_mail[4].split("verify=")[1]})
    assert v.status_code == 200 and v.json()["pending_approval"] is True and not v.json()["access_token"]
    assert config.REFRESH_COOKIE not in client.cookies
    assert any(m[0] == "boss@example.com" for m in mails)  # now the admin is asked
    assert [p["email"] for p in client.get("/api/admin/pending", headers=h).json()] == ["bob@example.com"]
    assert login(client).status_code == 403
    client.post(f"/api/admin/users/{uid()}/approve", headers=h)
    assert login(client).json()["access_token"]
    again = client.post("/api/auth/verify-email", json={"token": verify_mail[4].split("verify=")[1]})
    assert again.json()["access_token"]  # an approved user who clicks the link again is simply logged in


def test_clicking_the_verify_link_twice_asks_the_admin_once(client, approval, mails, monkeypatch):
    monkeypatch.setattr(config, "REQUIRE_EMAIL_VERIFICATION", True)
    admin(client)
    register(client)
    token = next(m for m in mails if m[0] == "bob@example.com")[4].split("verify=")[1]
    client.post("/api/auth/verify-email", json={"token": token})
    client.post("/api/auth/verify-email", json={"token": token})
    assert sum(1 for m in mails if m[0] == "boss@example.com") == 1


def test_password_reset_does_not_get_around_approval(client, approval, mails):
    admin(client)
    register(client)
    client.post("/api/auth/forgot-password", json={"email": "bob@example.com"})
    token = next(m for m in mails if m[0] == "bob@example.com")[4].split("reset=")[1]
    r = client.post("/api/auth/reset-password", json={"token": token, "password": "A-fresh-start-9"})
    assert r.status_code == 200 and r.json()["pending_approval"] is True and not r.json()["access_token"]
    assert config.REFRESH_COOKIE not in client.cookies


def test_unapproved_account_has_no_api_access_even_with_a_valid_login(client, mails):
    """If an account is un-approved after it logged in (e.g. edited in the database), its tokens stop working."""
    from conftest import signup

    h = signup(client, "bob")
    with SessionLocal() as db:
        db.get(User, uid()).approved = False
        db.commit()
    assert client.get("/api/entries", headers=h).status_code == 403
    assert client.post("/api/auth/refresh").status_code == 401


# ---------- who is affected ----------
def test_approval_is_off_by_default_so_signup_works_as_before(client):
    assert config.REQUIRE_APPROVAL is False
    r = register(client)
    assert r.json()["access_token"] and row().approved is True


def test_accounts_created_by_an_admin_are_approved(client, approval, mails, monkeypatch):
    monkeypatch.setattr(config, "EMAIL_ENABLED", True)
    h = admin(client)
    assert client.post("/api/admin/users", json={"email": "new@example.com"}, headers=h).status_code == 201
    assert row("new").approved is True


def test_overview_counts_waiting_requests(client, approval, mails, monkeypatch):
    h = admin(client)
    register(client, "bob")
    register(client, "eve")
    data = client.get("/api/admin/overview", headers=h).json()
    assert data["pendingApproval"] == 2
    client.post(f"/api/admin/users/{uid('bob')}/approve", headers=h)
    assert client.get("/api/admin/overview", headers=h).json()["pendingApproval"] == 1
    users = client.get("/api/admin/users", headers=h).json()["items"]
    assert {u["email"]: u["approved"] for u in users} == {"boss@example.com": True, "bob@example.com": True, "eve@example.com": False}


def test_production_turns_approval_on_by_default():
    import importlib
    import os

    old = {k: os.environ.get(k) for k in ("ENVIRONMENT", "REQUIRE_ADMIN_APPROVAL")}
    try:
        os.environ["ENVIRONMENT"] = "production"
        os.environ.pop("REQUIRE_ADMIN_APPROVAL", None)
        assert importlib.reload(config).REQUIRE_APPROVAL is True
        os.environ["REQUIRE_ADMIN_APPROVAL"] = "false"
        assert importlib.reload(config).REQUIRE_APPROVAL is False
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(config)
