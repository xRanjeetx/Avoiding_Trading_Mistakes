from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from ..core.security import (
    current_user, hash_password, make_purpose_token, make_token, user_from_purpose_token, verify_password,
)
from ..models import Entry, User, UserSettings
from ..schemas import Credentials, DeleteAccountIn, EmailOnly, MeOut, RegisterOut, ResetIn, Token, TokenIn
from ..services.mailer import send_link_email
from ..services.storage import delete_quietly
from .images import user_image_keys
from .library import delete_progress_for

router = APIRouter()

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


def _token(db: Session, user: User) -> Token:
    return Token(access_token=make_token(user), email=user.email, is_admin=user.is_admin)


@router.post("/api/auth/register", response_model=RegisterOut, status_code=status.HTTP_201_CREATED)
def register(body: Credentials, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if not config.ALLOW_REGISTRATION:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is closed")
    user = User(
        email=body.email.strip().lower(), password_hash=hash_password(body.password),
        email_verified=not config.REQUIRE_EMAIL_VERIFICATION,
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
        return RegisterOut(email=user.email, verification_sent=True)
    return RegisterOut(access_token=_token(db, user).access_token, email=user.email)


@router.post("/api/auth/login", response_model=Token)
def login(body: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    if config.REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please verify your email first. Check your inbox for the link.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    return _token(db, user)


@router.get("/api/auth/me", response_model=MeOut)
def me(user: User = Depends(current_user)):
    return MeOut(email=user.email, is_admin=user.is_admin).model_dump(by_alias=True)


@router.post("/api/auth/delete-account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: DeleteAccountIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Erases the signed-in user and all of their data, after re-entering the password."""
    if user.is_admin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin accounts cannot be deleted here")
    # 403, not 401: the frontend treats a 401 as an expired login and signs the user out.
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wrong password")
    # Explicit deletes: SQLite (dev/tests) does not enforce ON DELETE CASCADE by default.
    images = user_image_keys(db, user.id)
    db.execute(delete(Entry).where(Entry.user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    delete_progress_for(db, user.id)
    db.delete(user)
    db.commit()
    delete_quietly(images)


@router.post("/api/auth/verify-email", response_model=Token)
def verify_email(body: TokenIn, db: Session = Depends(get_db)):
    user = user_from_purpose_token(db, body.token, "verify")
    if not user.email_verified:
        user.email_verified = True
        db.commit()
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    return _token(db, user)


# The two endpoints below always answer the same way, so they cannot be used to find out which emails have accounts.
@router.post("/api/auth/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(body: EmailOnly, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user and not user.email_verified:
        tasks.add_task(_send_verification, user)
    return {"ok": True}


@router.post("/api/auth/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(body: EmailOnly, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user:
        tasks.add_task(_send_reset, user)
    return {"ok": True}


@router.post("/api/auth/reset-password", response_model=Token)
def reset_password(body: ResetIn, db: Session = Depends(get_db)):
    user = user_from_purpose_token(db, body.token, "reset")
    user.password_hash = hash_password(body.password)
    user.email_verified = True  # they received the link at this address, which proves they own it
    db.commit()
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    return _token(db, user)
