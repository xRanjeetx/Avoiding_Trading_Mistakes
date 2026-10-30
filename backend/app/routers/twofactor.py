"""Two-factor sign-in with an authenticator app (TOTP) and single-use recovery codes.

Anyone can turn it on in Settings. Admins must have it on to use the admin tools in production (ADMIN_REQUIRE_2FA).
Flow: /2fa/setup (password) -> scan the QR code -> /2fa/enable (first code) -> recovery codes are shown once.
At sign-in, /login answers `mfa_required` instead of a session, and /login/2fa finishes it with a code."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..core import config, crypto, totp
from ..core.db import get_db
from ..core.observability import security_event
from ..core.ratelimit import client_ip, ip_limit, limiter, too_many
from ..core.security import current_user, user_from_purpose_token, verify_password
from ..models import User
from ..schemas import CodeIn, DisableTwoFactorIn, LoginOut, MfaIn, PasswordIn
from .auth import QUARTER, LOGIN_FAILURES, _token

router = APIRouter(prefix="/api/auth", tags=["two-factor"])


def _wrong(user: User, request: Request, what: str) -> HTTPException:
    security_event("mfa_failed", client_ip(request), user.id, step=what)
    # 403, not 401: the frontend treats a 401 as an expired login and signs the user out.
    return HTTPException(status.HTTP_403_FORBIDDEN, "That code is not right. Try the newest code from your app, or a recovery code.")


def _guard(user: User) -> None:
    wait = limiter.blocked(f"mfa:user:{user.id}", LOGIN_FAILURES, QUARTER)
    if wait:
        raise too_many(wait)


def _accept_code(db: Session, user: User, code: str) -> bool:
    """True if `code` is a fresh authenticator code or an unused recovery code (which is then used up). Commits."""
    secret = crypto.decrypt(user.totp_secret) if user.totp_secret else None
    if secret:
        step = totp.check(secret, code, user.totp_last_step)
        if step is not None:
            user.totp_last_step = step
            db.commit()
            return True
    remaining = totp.use_recovery_code(user.recovery_hashes, code)
    if remaining is not None:
        user.recovery_hashes = remaining
        db.commit()
        return True
    return False


@router.post("/2fa/setup", dependencies=[ip_limit("mfa-setup", 20, 3600)])
def setup(body: PasswordIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Starts (or restarts) setup: a new seed, shown as a QR code and as text. Turned on only by /2fa/enable."""
    _guard(user)
    if user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor sign-in is already on")
    if not verify_password(body.password, user.password_hash):
        limiter.record(f"mfa:user:{user.id}", QUARTER)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wrong password")
    secret = totp.new_secret()
    user.totp_secret = crypto.encrypt(secret)
    db.commit()
    uri = totp.provisioning_uri(secret, user.email)
    return {"secret": secret, "otpauthUrl": uri, "qr": totp.qr_data_uri(uri)}


@router.post("/2fa/enable")
def enable(body: CodeIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Confirms the app works by checking a first code, turns 2FA on, and returns the recovery codes (shown only now)."""
    _guard(user)
    secret = crypto.decrypt(user.totp_secret) if user.totp_secret else None
    if user.totp_enabled or not secret:
        raise HTTPException(status.HTTP_409_CONFLICT, "Start the setup first")
    step = totp.check(secret, body.code, None)
    if step is None:
        limiter.record(f"mfa:user:{user.id}", QUARTER)
        raise _wrong(user, request, "enable")
    codes, hashes = totp.new_recovery_codes()
    user.totp_enabled, user.totp_last_step, user.recovery_hashes = True, step, hashes
    db.commit()
    security_event("mfa_enabled", client_ip(request), user.id)
    return {"recoveryCodes": codes}


@router.post("/2fa/disable")
def disable(body: DisableTwoFactorIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _guard(user)
    if user.is_admin and config.ADMIN_REQUIRE_2FA:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins cannot turn two-factor sign-in off")
    if not user.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-factor sign-in is not on")
    if not verify_password(body.password, user.password_hash):
        limiter.record(f"mfa:user:{user.id}", QUARTER)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wrong password")
    if not _accept_code(db, user, body.code):
        limiter.record(f"mfa:user:{user.id}", QUARTER)
        raise _wrong(user, request, "disable")
    clear_two_factor(user)
    db.commit()
    security_event("mfa_disabled", client_ip(request), user.id)
    return {"ok": True}


@router.post("/login/2fa", response_model=LoginOut, dependencies=[ip_limit("mfa-login", 60, QUARTER)])
def login_with_code(body: MfaIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Second step of signing in: the `mfa_token` from /login (valid 5 minutes) plus a code."""
    user = user_from_purpose_token(db, body.mfa_token, "mfa")
    if not user.is_active or not user.totp_enabled:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This link is invalid or has expired")
    _guard(user)
    if not _accept_code(db, user, body.code):
        limiter.record(f"mfa:user:{user.id}", QUARTER)
        raise _wrong(user, request, "login")
    limiter.clear(f"mfa:user:{user.id}")
    return _token(db, user, request, response)


def clear_two_factor(user: User) -> None:
    user.totp_enabled, user.totp_secret, user.totp_last_step, user.recovery_hashes = False, None, None, None
