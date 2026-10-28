import uuid
from contextlib import asynccontextmanager

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import config
from .db import Base, engine, get_db
from .mailer import send_link_email
from .models import Entry, User, UserSettings
from .admin import router as admin_router
from .schemas import Credentials, EmailOnly, EntryIn, EntryOut, MeOut, RegisterOut, ResetIn, SettingsOut, Token, TokenIn
from .security import (
    current_user, hash_password, make_purpose_token, make_token, user_from_purpose_token, verify_password,
)


def ensure_columns(eng) -> None:
    """create_all only creates missing tables, so add columns introduced after a table already exists."""
    have = {c["name"] for c in inspect(eng).get_columns("user_settings")}
    for col in ("killzones", "pairs"):
        if col not in have:
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE user_settings ADD COLUMN {col} JSON"))
    # Accounts that already exist are treated as verified (the DEFAULT TRUE backfills them).
    user_cols = {c["name"] for c in inspect(eng).get_columns("users")}
    if "email_verified" not in user_cols:
        with eng.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE"))
    for col, ddl in (
        ("is_admin", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("is_active", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("created_at", "TIMESTAMP"),
    ):
        if col not in user_cols:
            with eng.begin() as conn:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {ddl}"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    ensure_columns(engine)
    yield


app = FastAPI(title="Trade Guard API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(admin_router)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # The default handler echoes the rejected value back. That breaks for NaN (not valid JSON, so a 500)
    # and would send a submitted password back in the response.
    detail = [{"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": detail})


@app.get("/api/health")
def health():
    return {"ok": True}


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


@app.post("/api/auth/register", response_model=RegisterOut, status_code=status.HTTP_201_CREATED)
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


@app.post("/api/auth/login", response_model=Token)
def login(body: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    if config.REQUIRE_EMAIL_VERIFICATION and not user.email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Please verify your email first. Check your inbox for the link.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    return _token(db, user)


@app.get("/api/auth/me", response_model=MeOut)
def me(user: User = Depends(current_user)):
    return MeOut(email=user.email, is_admin=user.is_admin).model_dump(by_alias=True)


@app.post("/api/auth/verify-email", response_model=Token)
def verify_email(body: TokenIn, db: Session = Depends(get_db)):
    user = user_from_purpose_token(db, body.token, "verify")
    if not user.email_verified:
        user.email_verified = True
        db.commit()
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    return _token(db, user)


# The two endpoints below always answer the same way, so they cannot be used to find out which emails have accounts.
@app.post("/api/auth/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(body: EmailOnly, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user and not user.email_verified:
        tasks.add_task(_send_verification, user)
    return {"ok": True}


@app.post("/api/auth/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(body: EmailOnly, tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if user:
        tasks.add_task(_send_reset, user)
    return {"ok": True}


@app.post("/api/auth/reset-password", response_model=Token)
def reset_password(body: ResetIn, db: Session = Depends(get_db)):
    user = user_from_purpose_token(db, body.token, "reset")
    user.password_hash = hash_password(body.password)
    user.email_verified = True  # they received the link at this address, which proves they own it
    db.commit()
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")
    return _token(db, user)


# ---------- Settings ----------
def _settings_row(db: Session, user: User) -> UserSettings:
    row = db.get(UserSettings, user.id)
    if not row:
        row = UserSettings(user_id=user.id)
        db.add(row)
        db.commit()
    return row


@app.get("/api/settings", response_model=SettingsOut)
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _settings_row(db, user)


@app.put("/api/settings", response_model=SettingsOut)
def put_settings(body: SettingsOut, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _settings_row(db, user)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    db.commit()
    return row


# ---------- Entries ----------
def _get_entry(db: Session, user: User, entry_id: str) -> Entry:
    row = db.get(Entry, (user.id, entry_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return row


@app.get("/api/entries", response_model=list[EntryOut])
def list_entries(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Entry).where(Entry.user_id == user.id).order_by(Entry.timestamp)).all()


@app.post("/api/entries", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    entry_id = body.id or uuid.uuid4().hex
    if db.get(Entry, (user.id, entry_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Entry id already exists")
    row = Entry(user_id=user.id, id=entry_id, **body.model_dump(exclude={"id"}))
    db.add(row)
    db.commit()
    return row


@app.put("/api/entries/{entry_id}", response_model=EntryOut)
def update_entry(entry_id: str, body: EntryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = _get_entry(db, user, entry_id)
    for key, value in body.model_dump(exclude={"id"}).items():
        setattr(row, key, value)
    db.commit()
    return row


@app.delete("/api/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entry(entry_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_get_entry(db, user, entry_id))
    db.commit()


@app.delete("/api/entries", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_entries(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(delete(Entry).where(Entry.user_id == user.id))
    db.commit()

