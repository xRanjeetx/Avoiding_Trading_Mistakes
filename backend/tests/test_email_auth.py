import pytest

from app.core import config
from app.routers import auth
from app.models import User
from app.core.db import SessionLocal
from app.core.security import make_purpose_token, make_token

PW = "password123"


@pytest.fixture()
def mails(monkeypatch):
    """Turns verification on and captures outgoing emails as (to, link)."""
    sent = []
    monkeypatch.setattr(config, "REQUIRE_EMAIL_VERIFICATION", True)
    monkeypatch.setattr(auth, "send_link_email", lambda to, subject, intro, button, link, outro: sent.append((to, link)))
    return sent


def token_of(link):
    return link.split("=", 1)[1]


def register(client, name="alice"):
    return client.post("/api/auth/register", json={"email": f"{name}@example.com", "password": PW})


def test_register_requires_verification_before_login(client, mails):
    r = register(client)
    assert r.status_code == 201 and r.json()["access_token"] is None and r.json()["verification_sent"]
    assert len(mails) == 1 and "?verify=" in mails[0][1]
    login = client.post("/api/auth/login", json={"email": "alice@example.com", "password": PW})
    assert login.status_code == 403

    v = client.post("/api/auth/verify-email", json={"token": token_of(mails[0][1])})
    assert v.status_code == 200
    assert client.get("/api/settings", headers={"Authorization": f"Bearer {v.json()['access_token']}"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": PW}).status_code == 200


def test_resend_verification_is_generic(client, mails):
    register(client)
    mails.clear()
    assert client.post("/api/auth/resend-verification", json={"email": "alice@example.com"}).status_code == 202
    assert client.post("/api/auth/resend-verification", json={"email": "nobody@example.com"}).status_code == 202
    assert len(mails) == 1  # only the real, unverified account got mail


def test_forgot_and_reset_password(client, mails):
    register(client)
    client.post("/api/auth/verify-email", json={"token": token_of(mails[0][1])})
    mails.clear()
    assert client.post("/api/auth/forgot-password", json={"email": "alice@example.com"}).status_code == 202
    assert client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"}).status_code == 202
    assert len(mails) == 1 and "?reset=" in mails[0][1]

    token = token_of(mails[0][1])
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "newpassword9"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": PW}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "newpassword9"}).status_code == 200
    # The link is single use: the password changed, so the token no longer matches.
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "another-pass1"}).status_code == 400


def test_reset_also_verifies_the_email(client, mails):
    register(client)
    mails.clear()
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    client.post("/api/auth/reset-password", json={"token": token_of(mails[0][1]), "password": "newpassword9"})
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "newpassword9"}).status_code == 200


def test_tokens_cannot_be_swapped(client, mails):
    register(client)
    with SessionLocal() as db:
        user = db.query(User).one()
    verify, reset, login = make_purpose_token(user, "verify", 5), make_purpose_token(user, "reset", 5), make_token(user)
    # A verify token can't reset a password, a reset token can't verify, a login token is neither.
    assert client.post("/api/auth/reset-password", json={"token": verify, "password": "newpassword9"}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": reset}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": login}).status_code == 400
    # And an emailed token can't be used as a login token.
    assert client.get("/api/entries", headers={"Authorization": f"Bearer {reset}"}).status_code == 401
    expired = make_purpose_token(user, "verify", -1)
    assert client.post("/api/auth/verify-email", json={"token": expired}).status_code == 400


def test_without_smtp_registration_logs_in_directly(client):
    r = register(client)
    assert r.json()["access_token"] and not r.json()["verification_sent"]
