"""Two-factor sign-in (authenticator app + recovery codes)."""
import base64
import time

import pytest
from conftest import signup
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.cli.create_admin import create_admin
from app.cli.reset_2fa import reset_2fa
from app.core import config, crypto, totp
from app.core.db import SessionLocal
from app.core.ratelimit import limiter
from app.models import AuditLog, User
from app.routers import auth as auth_router

PW = "correct-horse-42"


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def user_row(email="alice@example.com"):
    with SessionLocal() as db:
        return db.scalar(select(User).where(User.email == email))


def now_code(secret, offset=0):
    return totp.code_at(secret, totp.current_step() + offset)


def enroll(client, h, password=PW):
    """Turns 2FA on for the signed-in user. Returns (secret, recovery codes)."""
    setup = client.post("/api/auth/2fa/setup", json={"password": password}, headers=h)
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    done = client.post("/api/auth/2fa/enable", json={"code": now_code(secret)}, headers=h)
    assert done.status_code == 200, done.text
    return secret, done.json()["recoveryCodes"]


def login(client, email="alice@example.com"):
    return client.post("/api/auth/login", json={"email": email, "password": PW})


def next_step_code(secret):
    """A valid code for a step later than the one already used (the server refuses re-use of a step)."""
    return now_code(secret, 1)


# ---------- the algorithm ----------
@pytest.mark.parametrize("at, expected", [(59, "287082"), (1111111109, "081804"), (1111111111, "050471"), (1234567890, "005924"), (2000000000, "279037")])
def test_matches_the_rfc_6238_test_vectors(at, expected):
    secret = base64.b32encode(b"12345678901234567890").decode()  # the RFC's SHA-1 test key
    assert totp.code_at(secret, at // 30) == expected  # the RFC lists 8 digits; these are their last 6


def test_check_accepts_neighbouring_steps_and_rejects_replays_and_junk():
    secret = totp.new_secret()
    t = 1_700_000_000
    step = totp.current_step(t)
    assert totp.check(secret, totp.code_at(secret, step), None, t) == step
    assert totp.check(secret, totp.code_at(secret, step - 1), None, t) == step - 1  # clock a little behind
    assert totp.check(secret, totp.code_at(secret, step + 1), None, t) == step + 1  # clock a little ahead
    assert totp.check(secret, totp.code_at(secret, step + 2), None, t) is None
    assert totp.check(secret, totp.code_at(secret, step), step, t) is None  # already used
    assert totp.check(secret, "12345", None, t) is None and totp.check(secret, "abcdef", None, t) is None
    assert totp.check(secret, " " + totp.code_at(secret, step)[:3] + " " + totp.code_at(secret, step)[3:], None, t) == step


def test_recovery_codes_are_single_use():
    codes, hashes = totp.new_recovery_codes()
    assert len(set(codes)) == totp.RECOVERY_CODES and all(len(c) == 11 and c[5] == "-" for c in codes)
    left = totp.use_recovery_code(hashes, codes[0].upper().replace("-", " "))  # spacing and case do not matter
    assert left is not None and len(left) == len(hashes) - 1
    assert totp.use_recovery_code(left, codes[0]) is None
    assert totp.use_recovery_code(left, "00000-00000") is None


def test_qr_code_and_uri():
    uri = totp.provisioning_uri("ABC234", "a+b@example.com")
    assert uri.startswith("otpauth://totp/Trade%20Guard%3Aa%2Bb%40example.com?secret=ABC234&issuer=Trade%20Guard")
    assert totp.qr_data_uri(uri).startswith("data:image/svg+xml")


def test_secrets_round_trip_and_wrong_key_fails(monkeypatch):
    token = crypto.encrypt("JBSWY3DPEHPK3PXP")
    assert "JBSWY3DP" not in token and crypto.decrypt(token) == "JBSWY3DPEHPK3PXP"
    assert crypto.decrypt("garbage") is None
    monkeypatch.setattr(config, "SECRET_KEY", "a-different-secret-key-of-enough-length")
    assert crypto.decrypt(token) is None


# ---------- enrolling ----------
def test_setup_needs_the_password_and_returns_a_scannable_secret(client):
    h = signup(client)
    assert client.post("/api/auth/2fa/setup", json={"password": "wrong-password-1"}, headers=h).status_code == 403
    assert client.post("/api/auth/2fa/setup", json={"password": PW}).status_code == 401
    r = client.post("/api/auth/2fa/setup", json={"password": PW}, headers=h).json()
    assert r["qr"].startswith("data:image/svg+xml") and r["otpauthUrl"].endswith("period=30") and len(r["secret"]) >= 32
    row = user_row()
    assert row.totp_enabled is False  # not on until a code is confirmed
    assert row.totp_secret and r["secret"] not in row.totp_secret  # stored encrypted
    assert crypto.decrypt(row.totp_secret) == r["secret"]


def test_enable_checks_the_first_code_and_shows_recovery_codes_once(client):
    h = signup(client)
    assert client.post("/api/auth/2fa/enable", json={"code": "123456"}, headers=h).status_code == 409  # no setup yet
    secret = client.post("/api/auth/2fa/setup", json={"password": PW}, headers=h).json()["secret"]
    assert client.post("/api/auth/2fa/enable", json={"code": "000000"}, headers=h).status_code == 403
    done = client.post("/api/auth/2fa/enable", json={"code": now_code(secret)}, headers=h)
    assert done.status_code == 200 and len(done.json()["recoveryCodes"]) == totp.RECOVERY_CODES
    row = user_row()
    assert row.totp_enabled and len(row.recovery_hashes) == totp.RECOVERY_CODES
    assert not any(c.replace("-", "") in str(row.recovery_hashes) for c in done.json()["recoveryCodes"])  # only hashes are kept
    assert client.get("/api/auth/me", headers=h).json()["twoFactor"] is True
    assert client.post("/api/auth/2fa/setup", json={"password": PW}, headers=h).status_code == 409


# ---------- signing in ----------
def test_login_with_2fa_needs_a_code_and_gives_no_session_before(client):
    h = signup(client)
    secret, _ = enroll(client, h)
    client.cookies.clear()
    r = login(client)
    body = r.json()
    assert r.status_code == 200 and body["mfa_required"] is True and body["mfa_token"] and not body["access_token"]
    assert config.REFRESH_COOKIE not in client.cookies and "set-cookie" not in r.headers  # no session yet
    assert client.post("/api/auth/refresh").status_code == 401
    ok = client.post("/api/auth/login/2fa", json={"mfa_token": body["mfa_token"], "code": next_step_code(secret)})
    assert ok.status_code == 200 and ok.json()["email"] == "alice@example.com"
    assert client.get("/api/entries", headers=bearer(ok.json()["access_token"])).status_code == 200
    assert client.cookies.get(config.REFRESH_COOKIE)


def test_a_wrong_code_is_refused_and_a_used_code_cannot_be_replayed(client):
    h = signup(client)
    secret, _ = enroll(client, h)
    token = login(client).json()["mfa_token"]
    assert client.post("/api/auth/login/2fa", json={"mfa_token": token, "code": "000000"}).status_code == 403
    code = next_step_code(secret)
    assert client.post("/api/auth/login/2fa", json={"mfa_token": token, "code": code}).status_code == 200
    again = client.post("/api/auth/login/2fa", json={"mfa_token": login(client).json()["mfa_token"], "code": code})
    assert again.status_code == 403  # the same code a second time


def test_the_code_used_to_enable_cannot_be_used_to_sign_in(client):
    h = signup(client)
    secret, _ = enroll(client, h)
    r = client.post("/api/auth/login/2fa", json={"mfa_token": login(client).json()["mfa_token"], "code": now_code(secret)})
    assert r.status_code == 403


def test_recovery_code_signs_in_once(client):
    h = signup(client)
    _, codes = enroll(client, h)
    first = client.post("/api/auth/login/2fa", json={"mfa_token": login(client).json()["mfa_token"], "code": codes[0]})
    assert first.status_code == 200
    second = client.post("/api/auth/login/2fa", json={"mfa_token": login(client).json()["mfa_token"], "code": codes[0]})
    assert second.status_code == 403
    other = client.post("/api/auth/login/2fa", json={"mfa_token": login(client).json()["mfa_token"], "code": codes[1].upper()})
    assert other.status_code == 200
    assert len(user_row().recovery_hashes) == totp.RECOVERY_CODES - 2


def test_mfa_token_cannot_be_used_as_other_tokens_and_vice_versa(client):
    h = signup(client)
    secret, _ = enroll(client, h)
    mfa = login(client).json()["mfa_token"]
    assert client.get("/api/entries", headers=bearer(mfa)).status_code == 401
    assert client.post("/api/auth/verify-email", json={"token": mfa}).status_code == 400
    assert client.post("/api/auth/reset-password", json={"token": mfa, "password": "A-fresh-start-9"}).status_code == 400
    assert client.post("/api/auth/login/2fa", json={"mfa_token": h["Authorization"].split()[1], "code": now_code(secret, 1)}).status_code == 400
    assert client.post("/api/auth/login/2fa", json={"mfa_token": "junk", "code": "123456"}).status_code == 400


def test_guessing_codes_locks_the_account_for_a_while(client, monkeypatch):
    h = signup(client)
    secret, _ = enroll(client, h)
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    limiter.reset()
    token = login(client).json()["mfa_token"]
    for _ in range(5):
        assert client.post("/api/auth/login/2fa", json={"mfa_token": token, "code": "000000"}).status_code == 403
    locked = client.post("/api/auth/login/2fa", json={"mfa_token": token, "code": next_step_code(secret)})
    assert locked.status_code == 429  # even the right code, until the window passes


def test_password_reset_does_not_get_around_2fa(client, monkeypatch):
    sent = []
    monkeypatch.setattr(auth_router, "send_link_email", lambda *a, **k: sent.append(a))
    h = signup(client)
    secret, _ = enroll(client, h)
    client.cookies.clear()
    client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    r = client.post("/api/auth/reset-password", json={"token": sent[0][4].split("reset=")[1], "password": "A-fresh-start-9"})
    body = r.json()
    assert r.status_code == 200 and body["mfa_required"] is True and not body["access_token"]
    assert config.REFRESH_COOKIE not in client.cookies
    done = client.post("/api/auth/login/2fa", json={"mfa_token": body["mfa_token"], "code": next_step_code(secret)})
    assert done.status_code == 200 and done.json()["access_token"]
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "A-fresh-start-9"}).json()["mfa_required"]


def test_users_without_2fa_log_in_as_before(client):
    signup(client)
    body = login(client).json()
    assert body["access_token"] and body["mfa_required"] is False and body["mfa_token"] is None


# ---------- turning it off ----------
def test_disable_needs_password_and_code(client):
    h = signup(client)
    secret, codes = enroll(client, h)
    assert client.post("/api/auth/2fa/disable", json={"password": "wrong-password-1", "code": codes[0]}, headers=h).status_code == 403
    assert client.post("/api/auth/2fa/disable", json={"password": PW, "code": "000000"}, headers=h).status_code == 403
    assert user_row().totp_enabled
    assert client.post("/api/auth/2fa/disable", json={"password": PW, "code": codes[0]}, headers=h).status_code == 200
    row = user_row()
    assert not row.totp_enabled and row.totp_secret is None and row.recovery_hashes is None
    assert login(client).json()["access_token"]
    assert client.post("/api/auth/2fa/disable", json={"password": PW, "code": codes[1]}, headers=h).status_code == 409


# ---------- admins ----------
def admin_session(client):
    create_admin("boss@example.com", PW)
    r = client.post("/api/auth/login", json={"email": "boss@example.com", "password": PW}).json()
    return bearer(r["access_token"])


def test_admin_tools_need_2fa_when_required(client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_REQUIRE_2FA", True)
    h = admin_session(client)
    blocked = client.get("/api/admin/overview", headers=h)
    assert blocked.status_code == 403 and "Settings" in blocked.json()["detail"]
    assert client.get("/api/auth/me", headers=h).json()["isAdmin"] is True  # still signed in, can open Settings
    secret, _ = enroll(client, h)
    assert client.get("/api/admin/overview", headers=h).status_code == 200
    assert client.post("/api/auth/2fa/disable", json={"password": PW, "code": "000000"}, headers=h).status_code == 403
    r = client.post("/api/auth/2fa/disable", json={"password": PW, "code": next_step_code(secret)}, headers=h)
    assert r.status_code == 403 and "Admins" in r.json()["detail"]
    assert user_row("boss@example.com").totp_enabled


def test_admin_2fa_is_not_required_by_default_in_development(client):
    h = admin_session(client)
    assert client.get("/api/admin/overview", headers=h).status_code == 200
    assert config.ADMIN_REQUIRE_2FA is False


def test_admin_can_reset_a_users_2fa_and_it_is_audited(client):
    bob = signup(client, "bob")
    enroll(client, bob)
    tab = TestClient(client.app)
    admin = admin_session(tab)
    bob_id = user_row("bob@example.com").id
    assert tab.post(f"/api/admin/users/{bob_id}/reset-2fa", headers=admin).status_code == 200
    row = user_row("bob@example.com")
    assert not row.totp_enabled and row.totp_secret is None
    assert client.get("/api/entries", headers=bob).status_code == 401  # signed out everywhere
    assert client.post("/api/auth/login", json={"email": "bob@example.com", "password": PW}).json()["access_token"]
    with SessionLocal() as db:
        assert [a.action for a in db.scalars(select(AuditLog))] == ["reset_2fa"]
    admin_id = user_row("boss@example.com").id
    assert tab.post(f"/api/admin/users/{admin_id}/reset-2fa", headers=admin).status_code == 400  # not for admins, here


def test_cli_reset_for_a_locked_out_admin(client):
    create_admin("boss@example.com", PW)
    h = admin_session(client)
    enroll(client, h)
    assert reset_2fa("Boss@Example.com") is True
    assert not user_row("boss@example.com").totp_enabled
    assert reset_2fa("nobody@example.com") is False
