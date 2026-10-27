import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import delete, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import config
from .db import Base, engine, get_db
from .models import Entry, User, UserSettings
from .schemas import Credentials, EntryIn, EntryOut, SettingsOut, Token
from .security import current_user, hash_password, make_token, verify_password


def ensure_columns(eng) -> None:
    """create_all only creates missing tables, so add columns introduced after a table already exists."""
    if "killzones" not in {c["name"] for c in inspect(eng).get_columns("user_settings")}:
        with eng.begin() as conn:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN killzones JSON"))


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
@app.post("/api/auth/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(body: Credentials, db: Session = Depends(get_db)):
    if not config.ALLOW_REGISTRATION:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is closed")
    user = User(email=body.email.strip().lower(), password_hash=hash_password(body.password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")
    db.add(UserSettings(user_id=user.id))
    db.commit()
    return Token(access_token=make_token(user), email=user.email)


@app.post("/api/auth/login", response_model=Token)
def login(body: Credentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    return Token(access_token=make_token(user), email=user.email)


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

