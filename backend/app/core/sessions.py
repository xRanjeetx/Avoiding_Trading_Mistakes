"""Login sessions: a short-lived access token (JWT, kept in the page's memory) plus a long-lived refresh token (random,
HttpOnly cookie, stored hashed in auth_sessions and replaced on every use)."""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Request, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from . import config
from .observability import security_event
from ..models import AuthSession, User

GRACE_SECONDS = 30  # how long the previous refresh token still works after a rotation (a second tab may be mid-flight)
MAX_SESSIONS_PER_USER = 10  # the least recently used ones are dropped beyond this


def now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # the database stores naive UTC


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _expiry(created_at: datetime, at: datetime) -> datetime:
    return min(at + timedelta(days=config.TOKEN_DAYS), created_at + timedelta(days=config.SESSION_MAX_DAYS))


def start_session(db: Session, user: User, request: Request) -> tuple[AuthSession, str]:
    at = now()
    raw = secrets.token_urlsafe(48)
    session = AuthSession(
        id=uuid.uuid4().hex, user_id=user.id, token_hash=hash_token(raw), created_at=at, last_used_at=at,
        expires_at=_expiry(at, at), user_agent=(request.headers.get("user-agent") or "")[:200] or None,
    )
    db.add(session)
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.expires_at < at))
    db.flush()
    keep = db.scalars(
        select(AuthSession.id).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.last_used_at.desc()).limit(MAX_SESSIONS_PER_USER)
    ).all()
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id.not_in(keep)))
    db.commit()
    return session, raw


def rotate(db: Session, raw: str) -> tuple[AuthSession, str | None] | None:
    """Swaps a valid refresh token for a new one. Returns (session, new token), or None if the token is not usable.
    The new token is None when a second tab sent the previous token within the grace period: that tab gets a fresh access
    token, and the cookie the first tab already received stays."""
    at = now()
    h = hash_token(raw)
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == h))
    if session:
        if session.revoked_at or session.expires_at <= at:
            return None
        fresh = secrets.token_urlsafe(48)
        session.prev_hash, session.token_hash = session.token_hash, hash_token(fresh)
        session.rotated_at = session.last_used_at = at
        session.expires_at = _expiry(session.created_at, at)
        db.commit()
        return session, fresh
    session = db.scalar(select(AuthSession).where(AuthSession.prev_hash == h))
    if session and not session.revoked_at and session.expires_at > at:
        if session.rotated_at and (at - session.rotated_at).total_seconds() <= GRACE_SECONDS:
            return session, None
        session.revoked_at = at  # an old token came back after its grace period: assume it was copied
        db.commit()
        security_event("refresh_token_reuse", user_id=session.user_id)
    return None


def revoke_by_token(db: Session, raw: str) -> None:
    h = hash_token(raw)
    db.execute(
        update(AuthSession).where((AuthSession.token_hash == h) | (AuthSession.prev_hash == h), AuthSession.revoked_at.is_(None))
        .values(revoked_at=now())
    )
    db.commit()


def revoke_all(db: Session, user_id: int, commit: bool = True) -> None:
    db.execute(update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)).values(revoked_at=now()))
    if commit:
        db.commit()


def is_live(session: AuthSession | None, user_id: int) -> bool:
    return bool(session and session.user_id == user_id and session.revoked_at is None and session.expires_at > now())


# ---------- the refresh cookie ----------
# Path=/api/auth: the browser sends it to the auth endpoints only, never with journal or image requests.
def _cookie_args() -> dict:
    return dict(httponly=True, secure=config.COOKIE_SECURE, samesite=config.COOKIE_SAMESITE, path="/api/auth")


def set_refresh_cookie(response: Response, raw: str) -> None:
    response.set_cookie(config.REFRESH_COOKIE, raw, max_age=config.TOKEN_DAYS * 86400, **_cookie_args())


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(config.REFRESH_COOKIE, **_cookie_args())
