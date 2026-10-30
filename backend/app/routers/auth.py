from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import SessionLocal, get_db
from ..core.observability import security_event
from ..core.passwords import require_strong
from ..core.ratelimit import client_ip, ip_limit, limiter, too_many
from ..core.sessions import (
    clear_refresh_cookie, revoke_all, revoke_by_token, rotate, set_refresh_cookie, start_session,
)
from ..core.security import (
    DUMMY_HASH, current_user, hash_password, make_purpose_token, make_token, user_from_purpose_token, verify_password,
)
from ..models import AuthSession, Entry, User, UserSettings
from ..schemas import (
    Credentials, DeleteAccountIn, EmailOnly, EntryOut, ForgotIn, LoginIn, LoginOut, MeOut, RegisterOut, ResetIn, SettingsOut, Token,
    TokenIn,
)
from ..services.captcha import verify_captcha
from ..services.mailer import send_link_email
from ..services.storage import delete_quietly
from .images import user_image_keys
from .library import delete_progress_for

router = APIRouter()

HOUR, QUARTER = 3600, 900
LOGIN_FAILURES = 5  # wrong passwords allowed per email per 15 minutes
EMAIL_SENDS = 3  # reset / verification emails per address per hour


def _require_captcha(token: str | None, request: Request) -> None:
    if not verify_captcha(token, client_ip(request)):
        security_event("captcha_failed", client_ip(request))
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please complete the human check and try again")


def _may_email(kind: str, email: str) -> bool:
    """Caps how many emails one address can be sent, so the endpoints cannot be used to flood someone's inbox."""
    return not limiter.hit(f"{kind}:email:{email}", EMAIL_SENDS, HOUR)


# ---------- Auth ----------
def _send_verification(user: User) -> None:
    token = make_purpose_token(user, "verify", config.VERIFY_HOURS * 60)
    send_link_email(
        user.email, "Verify your Trade Guard email",
        "Welcome to Trade Guard. Confirm your email address to activate your account.",
        "Verify email", f"{config.APP_URL}/?verify={token}",
        f"This link expires in {config.VERIFY_HOURS} hours. If you did not create an account, ignore this email.",
    )


def _send_reset(user: User) -> None:
    token = make_purpose_token(user, "reset", config.RESET_MINUTES)
    send_link_email(
        user.email, "Reset your Trade Guard password",
        "We received a request to reset your password.",
        "Reset password", f"{config.APP_URL}/?reset={token}",
        f"This link expires in {config.RESET_MINUTES} minutes and works once. If you did not ask for this, ignore this email.",
    )


WAITING = "Your account is waiting for admin approval. We will email you as soon as it is approved."


def _notify_admins(email: str) -> None:
    """Tells every active admin that someone is waiting for approval. Runs in the background."""
    with SessionLocal() as db:
        admins = db.scalars(select(User.email).where(User.is_admin.is_(True), User.is_active.is_(True))).all()
    for admin_email in admins:
        send_link_email(
            admin_email, "A new Trade Guard sign-up is waiting for approval",
            f"{email} has verified their email address and is waiting for your approval.",
            "Review requests", config.APP_URL, "Open the Admin tab to approve or reject the request.",
        )


def _token(db: Session, user: User, request: Request, response: Response) -> Token:
    """Starts a login session: the refresh token goes into an HttpOnly cookie, the short-lived access token into the body."""
    session, refresh_token = start_session(db, user, request)
    set_refresh_cookie(response, refresh_token)
    return Token(access_token=make_token(user, session.id), email=user.email, is_admin=user.is_admin)


def _same_origin_or_listed(request: Request) -> None:
    """The refresh cookie rides along on requests from any site when SameSite=None, so refuse browser calls that come from
    a page that is not one of ours. (Browsers always send Origin on cross-site POSTs; tools without one carry no cookie.)"""
    origin = request.headers.get("origin")
    if origin and origin not in config.CORS_ORIGINS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Request not allowed from this site")


@router.post("/api/auth/register", response_model=RegisterOut, status_code=status.HTTP_201_CREATED, dependencies=[ip_limit("register", 10, HOUR)])
def register(body: Credentials, request: Request, response: Response, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if not config.ALLOW_REGISTRATION:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is closed")
    _require_captcha(body.captcha_token, request)
    require_strong(body.password, body.email)
    user = User(
        email=body.email.strip().lower(), password_hash=hash_password(body.password),
        email_verified=not config.REQUIRE_EMAIL_VERIFICATION, approved=not config.REQUIRE_APPROVAL,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")
    db.add(UserSettings(user_id=user.id))
    db.commit()
    if config.REQUIRE_EMAIL_VERIFICATION:
        tasks.add_task(_send_verification, user)
        return RegisterOut(email=user.email, verification_sent=True, pending_approval=not user.approved)
    if not user.approved:  # no email step, so the request is complete now
        tasks.add_task(_notify_admins, user.email)
        return RegisterOut(email=user.email, pending_approval=True)
    return RegisterOut(access_token=_token(db, user, request, response).access_token, email=user.email)


@router.post("/api/auth/login", response_model=LoginOut, dependencies=[ip_limit("login", 30, QUARTER)])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    failures = f"login:email:{email}"  # counted for unknown emails too, so the answer never reveals which accounts exist
    wait = limiter.blocked(failures, LOGIN_FAILURES, QUARTER)
    if wait:
        security_event("login_locked", client_ip(request))
        raise too_many(wait)
    user = db.scalar(select(User).where(User.email == email))
    password_ok = verify_password(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not password_ok:
        limiter.record(failures, QUARTER)
        security_event("login_failed", client_ip(request), user.id if user else None)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    limiter.clear(failures)
    if config.REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please verify your email first. Check your inbox for the link.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    if not user.approved:
        raise HTTPException(status.HTTP_403_FORBIDDEN, WAITING)
    if user.totp_enabled:  # the password alone is not enough: no session until /login/2fa has a code
        return LoginOut(mfa_required=True, mfa_token=make_purpose_token(user, "mfa", 5))
    return _token(db, user, request, response)


@router.post("/api/auth/refresh", response_model=Token, dependencies=[ip_limit("refresh", 300, HOUR)])
def refresh(
    request: Request, response: Response, db: Session = Depends(get_db),
    refresh_token: str | None = Cookie(None, alias=config.REFRESH_COOKIE),
):
    """Trades the refresh cookie for a new access token (and a new cookie). Called when the page opens and whenever the
    access token has expired."""
    _same_origin_or_listed(request)
    expired = HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please log in again.")
    result = rotate(db, refresh_token) if refresh_token else None
    if not result:
        raise expired
    session, fresh = result
    user = db.get(User, session.user_id)
    if not user or not user.is_active or not user.approved or (config.REQUIRE_EMAIL_VERIFICATION and not user.email_verified):
        raise expired
    if fresh:
        set_refresh_cookie(response, fresh)
    return Token(access_token=make_token(user, session.id), email=user.email, is_admin=user.is_admin)


@router.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db), refresh_token: str | None = Cookie(None, alias=config.REFRESH_COOKIE)):
    """Ends this device's login. Always succeeds, so a browser with a stale cookie can still clear it."""
    _same_origin_or_listed(request)
    if refresh_token:
        revoke_by_token(db, refresh_token)
    clear_refresh_cookie(response)


@router.post("/api/auth/logout-all", status_code=status.HTTP_204_NO_CONTENT)
def logout_all(response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Ends the login on every device, this one included."""
    revoke_all(db, user.id)
    clear_refresh_cookie(response)
    security_event("logout_all", user_id=user.id)


@router.get("/api/auth/me", response_model=MeOut)
def me(user: User = Depends(current_user)):
    return MeOut(email=user.email, is_admin=user.is_admin, two_factor=user.totp_enabled).model_dump(by_alias=True)


@router.get("/api/auth/export")
def export_data(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everything stored about the signed-in user as one JSON file (screenshots are not included)."""
    wait = limiter.hit(f"export:user:{user.id}", 5, HOUR)
    if wait:
        raise too_many(wait)
    settings = db.get(UserSettings, user.id)
    entries = db.scalars(select(Entry).where(Entry.user_id == user.id).order_by(Entry.timestamp)).all()
    data = {
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "account": {"email": user.email, "createdAt": user.created_at.isoformat() if user.created_at else None},
        "settings": SettingsOut.model_validate(settings).model_dump(by_alias=True) if settings else None,
        "entries": [EntryOut.model_validate(e).model_dump(by_alias=True, exclude={"images"}) for e in entries],
    }
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="trade-guard-data.json"'})


@router.post("/api/auth/delete-account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: DeleteAccountIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Erases the signed-in user and all of their data, after re-entering the password."""
    if user.is_admin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin accounts cannot be deleted here")
    key = f"delete:user:{user.id}"  # a stolen login must not be able to guess the password here
    wait = limiter.blocked(key, LOGIN_FAILURES, QUARTER)
    if wait:
        raise too_many(wait)
    # 403, not 401: the frontend treats a 401 as an expired login and signs the user out.
    if not verify_password(body.password, user.password_hash):
        limiter.record(key, QUARTER)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wrong password")
    # Explicit deletes: SQLite (dev/tests) does not enforce ON DELETE CASCADE by default.
    images = user_image_keys(db, user.id)
    db.execute(delete(Entry).where(Entry.user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    delete_progress_for(db, user.id)
    db.delete(user)
    db.commit()
    delete_quietly(images)


@router.post("/api/auth/verify-email", response_model=LoginOut, dependencies=[ip_limit("verify", 30, HOUR)])
def verify_email(body: TokenIn, request: Request, response: Response, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = user_from_purpose_token(db, body.token, "verify")
    newly_verified = not user.email_verified
    if newly_verified:
        user.email_verified = True
        db.commit()
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    if not user.approved:  # verified, but no session until an admin approves
        if newly_verified:
            tasks.add_task(_notify_admins, user.email)
        return LoginOut(email=user.email, pending_approval=True)
    return _token(db, user, request, response)


# The two endpoints below always answer the same way, so they cannot be used to find out which emails have accounts.
@router.post("/api/auth/resend-verification", status_code=status.HTTP_202_ACCEPTED, dependencies=[ip_limit("resend", 10, HOUR)])
def resend_verification(body: EmailOnly, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user and not user.email_verified and _may_email("resend", email):
        tasks.add_task(_send_verification, user)
    return {"ok": True}


@router.post("/api/auth/forgot-password", status_code=status.HTTP_202_ACCEPTED, dependencies=[ip_limit("forgot", 10, HOUR)])
def forgot_password(body: ForgotIn, request: Request, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    _require_captcha(body.captcha_token, request)
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if user and _may_email("forgot", email):
        tasks.add_task(_send_reset, user)
    return {"ok": True}


@router.post("/api/auth/reset-password", response_model=LoginOut, dependencies=[ip_limit("reset", 30, HOUR)])
def reset_password(body: ResetIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = user_from_purpose_token(db, body.token, "reset")
    require_strong(body.password, user.email)
    user.password_hash = hash_password(body.password)
    user.email_verified = True  # they received the link at this address, which proves they own it
    revoke_all(db, user.id, commit=False)  # whoever knew the old password (or held a stolen login) is signed out everywhere
    db.commit()
    security_event("password_reset", client_ip(request), user.id)
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    if not user.approved:
        return LoginOut(email=user.email, pending_approval=True)
    if user.totp_enabled:  # a reset link must not get around the second factor
        return LoginOut(mfa_required=True, mfa_token=make_purpose_token(user, "mfa", 5))
    return _token(db, user, request, response)
