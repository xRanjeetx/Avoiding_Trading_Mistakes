"""Admin-only endpoints. Only aggregate numbers are exposed, never entry contents (notes, lessons, prices)."""
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import get_db
from .images import user_image_keys
from .auth import _send_reset
from .library import delete_progress_for
from ..services.mailer import send_link_email
from ..models import AuditLog, AuthSession, Entry, User, UserSettings
from ..core.ratelimit import ip_limit
from ..core.security import make_purpose_token
from ..services import audit
from .twofactor import clear_two_factor
from ..schemas import ActiveIn, EmailOnly
from ..core.security import hash_password, require_admin
from ..core.sessions import revoke_all
from ..services.storage import delete_quietly

log = logging.getLogger("tradeguard.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[ip_limit("admin", 600, 3600)])


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _ms(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def _target(db: Session, admin: User, user_id: int, action: str) -> User:
    """The user an admin action applies to. Admins cannot act on themselves or on other admins."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id or user.is_admin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"You cannot {action} an admin account")
    return user


@router.get("/overview")
def overview(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    now = _now()
    since = lambda days: now - timedelta(days=days)  # noqa: E731
    count = lambda *where: db.scalar(select(func.count()).select_from(User).where(*where)) or 0  # noqa: E731
    active_users = db.scalar(
        select(func.count(func.distinct(Entry.user_id))).where(Entry.timestamp >= _ms(since(7)))
    ) or 0
    return {
        "totalUsers": count(),
        "verifiedUsers": count(User.email_verified.is_(True)),
        "disabledUsers": count(User.is_active.is_(False)),
        "pendingApproval": count(User.approved.is_(False), User.email_verified.is_(True)),
        "newLast7Days": count(User.created_at >= since(7)),
        "newLast30Days": count(User.created_at >= since(30)),
        "activeLast7Days": active_users,
        "totalEntries": db.scalar(select(func.count()).select_from(Entry)) or 0,
    }


@router.get("/growth")
def growth(days: int = Query(30, ge=7, le=90), _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Per UTC day for the last `days` days: new signups, and users who logged at least one trade (active)."""
    today = _now().date()
    first = today - timedelta(days=days - 1)
    first_ms = _ms(datetime.combine(first, datetime.min.time()))
    signups = {
        str(d): n
        for d, n in db.execute(
            select(func.date(User.created_at), func.count()).where(User.created_at >= first).group_by(func.date(User.created_at))
        )
    }
    day_idx = Entry.timestamp // 86_400_000  # whole days since 1970 (UTC)
    active = dict(
        db.execute(
            select(day_idx, func.count(func.distinct(Entry.user_id))).where(Entry.timestamp >= first_ms).group_by(day_idx)
        ).all()
    )
    epoch = datetime(1970, 1, 1).date()
    out = []
    for i in range(days):
        d = first + timedelta(days=i)
        out.append({"date": d.isoformat(), "signups": signups.get(d.isoformat(), 0), "active": active.get((d - epoch).days, 0)})
    return {"days": out}


@router.get("/users")
def list_users(
    q: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=5, le=100, alias="pageSize"),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """One page of users, newest first. A page past the end is clamped to the last page."""
    closed = (Entry.traded.is_(True)) & (Entry.result != "open") & (Entry.pnl.is_not(None))
    stats = (
        select(
            Entry.user_id.label("uid"),
            func.count().label("entries"),
            func.sum(case((closed, 1), else_=0)).label("closed"),
            func.sum(case((closed & (Entry.pnl > 0), 1), else_=0)).label("wins"),
            func.max(Entry.timestamp).label("last_ts"),
        )
        .group_by(Entry.user_id)
        .subquery()
    )
    query = select(User, stats.c.entries, stats.c.closed, stats.c.wins, stats.c.last_ts).outerjoin(
        stats, stats.c.uid == User.id
    )
    term = q.strip().lower()
    where = [User.email.contains(term, autoescape=True)] if term else []
    total = db.scalar(select(func.count()).select_from(User).where(*where)) or 0
    pages = max(1, -(-total // page_size))
    page = min(page, pages)
    rows = db.execute(query.where(*where).order_by(User.id.desc()).limit(page_size).offset((page - 1) * page_size)).all()
    items = [
        {
            "id": u.id,
            "email": u.email,
            "emailVerified": u.email_verified,
            "isActive": u.is_active,
            "approved": u.approved,
            "isAdmin": u.is_admin,
            "createdAt": u.created_at.isoformat() if u.created_at else None,
            "entries": entries or 0,
            "closedTrades": closed_n or 0,
            "winRate": round(100 * wins / closed_n) if closed_n else None,
            "lastEntryAt": last_ts,
        }
        for u, entries, closed_n, wins, last_ts in rows
    ]
    return {"items": items, "total": total, "page": page, "pageSize": page_size, "pages": pages}


def _send_approved(email: str) -> None:
    send_link_email(
        email, "Your Trade Guard account is approved",
        "An administrator approved your account. You can log in now.",
        "Log in", config.APP_URL, "If you did not sign up for Trade Guard, you can ignore this email.",
    )


def _send_welcome(user: User) -> None:
    """The new user chooses their own password through a one-time link. No password is ever sent by email."""
    token = make_purpose_token(user, "reset", config.RESET_MINUTES)
    send_link_email(
        user.email, "Your Trade Guard account",
        "An administrator created a Trade Guard account for you. Choose a password to start using it.",
        "Choose password", f"{config.APP_URL}/?reset={token}",
        f"This link expires in {config.RESET_MINUTES} minutes and works once. If it has expired, use Forgot password on the sign-in page.",
    )


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(
    body: EmailOnly, request: Request, tasks: BackgroundTasks, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    """Creates a verified account with a random password nobody knows, and emails the user a link to choose their own."""
    if not config.EMAIL_ENABLED:
        # Without email the user could never set a password, so refuse instead of creating an unusable account.
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Email is not configured, so the invitation cannot be sent")
    user = User(email=body.email.strip().lower(), password_hash=hash_password(secrets.token_urlsafe(32)), email_verified=True)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with that email already exists")
    db.add(UserSettings(user_id=user.id))
    audit.record(db, admin, "create_user", request, user.email)
    db.commit()
    tasks.add_task(_send_welcome, user)
    log.info("admin %s created user %s", admin.email, user.email)
    return {"ok": True, "id": user.id, "email": user.email}


@router.patch("/users/{user_id}")
def set_active(user_id: int, body: ActiveIn, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = _target(db, admin, user_id, "disable")
    user.is_active = body.is_active
    if not user.is_active:
        revoke_all(db, user.id, commit=False)  # a disabled user is signed out everywhere at once
    audit.record(db, admin, "enable_user" if user.is_active else "disable_user", request, user.email)
    db.commit()
    log.info("admin %s set is_active=%s on user %s", admin.email, body.is_active, user.email)
    return {"ok": True, "isActive": user.is_active}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = _target(db, admin, user_id, "delete")
    # Explicit deletes: SQLite (dev/tests) does not enforce ON DELETE CASCADE by default.
    images = user_image_keys(db, user.id)
    db.execute(delete(Entry).where(Entry.user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    delete_progress_for(db, user.id)
    db.delete(user)
    audit.record(db, admin, "delete_user", request, user.email)
    db.commit()
    delete_quietly(images)
    log.info("admin %s deleted user %s", admin.email, user.email)


@router.post("/users/{user_id}/verify")
def force_verify(user_id: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.email_verified = True
    audit.record(db, admin, "verify_user", request, user.email)
    db.commit()
    log.info("admin %s verified user %s", admin.email, user.email)
    return {"ok": True}


@router.post("/users/{user_id}/send-reset", status_code=status.HTTP_202_ACCEPTED)
def send_reset(
    user_id: int, request: Request, tasks: BackgroundTasks, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    tasks.add_task(_send_reset, user)
    audit.record(db, admin, "send_reset", request, user.email)
    db.commit()
    log.info("admin %s sent a password reset to user %s", admin.email, user.email)
    return {"ok": True}


@router.get("/pending")
def pending_requests(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Sign-ups that verified their email and wait for approval, oldest first."""
    rows = db.scalars(select(User).where(User.approved.is_(False), User.email_verified.is_(True)).order_by(User.id))
    return [{"id": u.id, "email": u.email, "createdAt": u.created_at.isoformat() if u.created_at else None} for u in rows]


@router.post("/users/{user_id}/approve")
def approve_user(user_id: int, request: Request, tasks: BackgroundTasks, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = _target(db, admin, user_id, "approve")
    if not user.approved:
        user.approved = True
        audit.record(db, admin, "approve_user", request, user.email)
        db.commit()
        tasks.add_task(_send_approved, user.email)
        log.info("admin %s approved user %s", admin.email, user.email)
    return {"ok": True}


@router.post("/users/{user_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject_user(user_id: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Declines a sign-up by erasing the account. Only for accounts that were never approved (they hold no data)."""
    user = _target(db, admin, user_id, "reject")
    if user.approved:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This account is already approved. Use Delete user instead.")
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.delete(user)
    audit.record(db, admin, "reject_user", request, user.email)
    db.commit()
    log.info("admin %s rejected sign-up %s", admin.email, user.email)


@router.post("/users/{user_id}/reset-2fa")
def reset_two_factor(user_id: int, request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """For a user who lost their phone and their recovery codes: turns their 2FA off and signs them out everywhere."""
    user = _target(db, admin, user_id, "reset two-factor sign-in for")
    clear_two_factor(user)
    revoke_all(db, user.id, commit=False)
    audit.record(db, admin, "reset_2fa", request, user.email)
    db.commit()
    return {"ok": True}


@router.get("/audit")
def audit_log(limit: int = Query(100, ge=1, le=500), _: User = Depends(require_admin), db: Session = Depends(get_db)):
    """The most recent admin actions, newest first."""
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit))
    return [
        {"at": r.at.isoformat(), "admin": r.admin_email, "action": r.action, "target": r.target_email, "ip": r.ip, "detail": r.detail}
        for r in rows
    ]
