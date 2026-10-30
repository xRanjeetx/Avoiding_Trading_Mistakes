"""Rate limits, password rules, human check and email caps on the auth endpoints."""
import httpx
import pytest

from app.core import config, passwords
from app.core.ratelimit import client_ip, limiter
from app.routers import auth as auth_router

from conftest import signup

PW = "correct-horse-42"


@pytest.fixture()
def limits_on(monkeypatch):
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    limiter.reset()


def login(client, email="alice@example.com", password=PW):
    return client.post("/api/auth/login", json={"email": email, "password": password})


# ---------- rate limits ----------
def test_wrong_passwords_lock_the_email_for_a_while(client, limits_on):
    signup(client)
    for _ in range(5):
        assert login(client, password="wrong-password-1").status_code == 401
    locked = login(client)  # even the right password is refused now
    assert locked.status_code == 429
    assert int(locked.headers["retry-after"]) > 0
    assert "Too many attempts" in locked.json()["detail"]


def test_unknown_emails_are_limited_the_same_way(client, limits_on):
    for _ in range(5):
        assert login(client, email="ghost@example.com").status_code == 401
    assert login(client, email="ghost@example.com").status_code == 429


def test_a_good_login_clears_the_failure_count(client, limits_on):
    signup(client)
    for _ in range(4):
        login(client, password="wrong-password-1")
    assert login(client).status_code == 200
    for _ in range(4):
        assert login(client, password="wrong-password-1").status_code == 401


def test_one_address_is_limited_across_emails(client, limits_on):
    for i in range(30):
        assert login(client, email=f"user{i}@example.com").status_code == 401
    assert login(client, email="another@example.com").status_code == 429


def test_registration_is_limited_per_address(client, limits_on):
    for i in range(10):
        assert client.post("/api/auth/register", json={"email": f"n{i}@example.com", "password": PW}).status_code == 201
    r = client.post("/api/auth/register", json={"email": "n10@example.com", "password": PW})
    assert r.status_code == 429


def test_delete_account_password_guessing_is_limited(client, auth, limits_on):
    for _ in range(5):
        assert client.post("/api/auth/delete-account", json={"password": "nope-nope-1"}, headers=auth).status_code == 403
    assert client.post("/api/auth/delete-account", json={"password": PW}, headers=auth).status_code == 429


def test_email_endpoints_send_at_most_three_mails_per_address(client, limits_on, monkeypatch):
    sent = []
    monkeypatch.setattr(auth_router, "send_link_email", lambda *a, **k: sent.append(a[0]))
    signup(client)
    for _ in range(6):
        assert client.post("/api/auth/forgot-password", json={"email": "alice@example.com"}).status_code == 202
    assert len(sent) == 3  # the answer stays the same, but the extra mails are not sent


def test_limits_are_off_when_disabled(client):
    for _ in range(40):
        assert login(client, email="ghost@example.com").status_code == 401


def test_client_ip_trusts_only_the_proxies_we_know(monkeypatch):
    class Req:
        client = type("C", (), {"host": "10.0.0.9"})()
        headers = {"x-forwarded-for": "6.6.6.6, 203.0.113.7"}  # the first entry was written by the caller

    assert client_ip(Req) == "10.0.0.9"  # PROXY_HOPS=0: the header is ignored
    monkeypatch.setattr(config, "PROXY_HOPS", 1)
    assert client_ip(Req) == "203.0.113.7"
    monkeypatch.setattr(config, "PROXY_HOPS", 3)
    assert client_ip(Req) == "10.0.0.9"  # fewer hops than expected: do not guess


# ---------- password rules ----------
@pytest.mark.parametrize("pw", ["password123", "1234567890", "tradeguard1", "aaaaaaaaaa", "alice-2024-x"])
def test_register_rejects_weak_passwords(client, pw):
    r = client.post("/api/auth/register", json={"email": "alice@example.com", "password": pw})
    assert r.status_code == 422, pw
    assert "Choose a different one" in r.json()["detail"]


def test_register_rejects_breached_passwords(client, monkeypatch):
    monkeypatch.setattr(config, "BREACH_CHECK_ENABLED", True)
    suffix = passwords.hashlib.sha1(b"Sunrise-Harbor-77", usedforsecurity=False).hexdigest().upper()[5:]
    monkeypatch.setattr(passwords.httpx, "get", lambda *a, **k: httpx.Response(
        200, text=f"0000000000000000000000000000000000A:0\r\n{suffix}:4821\r\n", request=httpx.Request("GET", a[0]),
    ))
    r = client.post("/api/auth/register", json={"email": "bob@example.com", "password": "Sunrise-Harbor-77"})
    assert r.status_code == 422
    assert "data breach" in r.json()["detail"]


def test_breach_check_lets_people_in_when_the_service_is_down(client, monkeypatch):
    monkeypatch.setattr(config, "BREACH_CHECK_ENABLED", True)

    def down(*a, **k):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(passwords.httpx, "get", down)
    assert client.post("/api/auth/register", json={"email": "bob@example.com", "password": "Sunrise-Harbor-77"}).status_code == 201


def test_padding_rows_do_not_count_as_a_breach(client, monkeypatch):
    monkeypatch.setattr(config, "BREACH_CHECK_ENABLED", True)
    suffix = passwords.hashlib.sha1(b"Sunrise-Harbor-77", usedforsecurity=False).hexdigest().upper()[5:]
    monkeypatch.setattr(passwords.httpx, "get", lambda *a, **k: httpx.Response(
        200, text=f"{suffix}:0\r\n", request=httpx.Request("GET", a[0]),
    ))
    assert client.post("/api/auth/register", json={"email": "bob@example.com", "password": "Sunrise-Harbor-77"}).status_code == 201


def test_reset_password_applies_the_same_rules(client, monkeypatch):
    sent = []
    monkeypatch.setattr(auth_router, "send_link_email", lambda *a, **k: sent.append(a))
    signup(client)
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    token = sent[0][4].split("reset=")[1]
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "password123"}).status_code == 422
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "short"}).status_code == 422
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "A-fresh-start-9"}).status_code == 200


def test_old_short_passwords_can_still_log_in(client):
    from app.core.db import SessionLocal
    from app.core.security import hash_password
    from app.models import User

    with SessionLocal() as db:
        db.add(User(email="old@example.com", password_hash=hash_password("short8pw"), email_verified=True))
        db.commit()
    assert login(client, "old@example.com", "short8pw").status_code == 200


# ---------- human check ----------
def test_signup_and_forgot_password_need_a_solved_challenge_when_enabled(client, monkeypatch):
    monkeypatch.setattr(config, "TURNSTILE_SECRET", "secret")
    seen = []
    monkeypatch.setattr(auth_router, "verify_captcha", lambda token, ip: seen.append(token) or token == "good")

    body = {"email": "alice@example.com", "password": PW}
    assert client.post("/api/auth/register", json=body).status_code == 400
    assert client.post("/api/auth/register", json={**body, "captcha_token": "bad"}).status_code == 400
    assert client.post("/api/auth/register", json={**body, "captcha_token": "good"}).status_code == 201
    assert client.post("/api/auth/forgot-password", json={"email": "alice@example.com"}).status_code == 400
    assert client.post("/api/auth/forgot-password", json={"email": "alice@example.com", "captcha_token": "good"}).status_code == 202
    assert login(client).status_code == 200  # logging in has no challenge (the lockout covers it)


def test_captcha_check_fails_closed(monkeypatch):
    from app.services import captcha

    monkeypatch.setattr(config, "TURNSTILE_SECRET", "secret")
    assert captcha.verify_captcha(None, "1.2.3.4") is False

    def down(*a, **k):
        raise httpx.ConnectError("offline")

    monkeypatch.setattr(captcha.httpx, "post", down)
    assert captcha.verify_captcha("token", "1.2.3.4") is False
    monkeypatch.setattr(captcha.httpx, "post", lambda *a, **k: httpx.Response(200, json={"success": True}))
    assert captcha.verify_captcha("token", "1.2.3.4") is True
    monkeypatch.setattr(config, "TURNSTILE_SECRET", "")
    assert captcha.verify_captcha(None, "1.2.3.4") is True
