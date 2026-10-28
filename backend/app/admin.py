"""Admin-only endpoints. Only aggregate numbers are exposed, never entry contents (notes, lessons, prices)."""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Entry, User, UserSettings
from .schemas import ActiveIn
from .security import require_admin

log = logging.getLogger("tradeguard.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


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
def list_users(q: str = "", _: User = Depends(require_admin), db: Session = Depends(get_db)):
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
    if term:
        query = query.where(User.email.contains(term, autoescape=True))
    rows = db.execute(query.order_by(User.id.desc()).limit(500)).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "emailVerified": u.email_verified,
            "isActive": u.is_active,
            "isAdmin": u.is_admin,
            "createdAt": u.created_at.isoformat() if u.created_at else None,
            "entries": entries or 0,
            "closedTrades": closed_n or 0,
            "winRate": round(100 * wins / closed_n) if closed_n else None,
            "lastEntryAt": last_ts,
        }
        for u, entries, closed_n, wins, last_ts in rows
    ]


@router.patch("/users/{user_id}")
def set_active(user_id: int, body: ActiveIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = _target(db, admin, user_id, "disable")
    user.is_active = body.is_active
    db.commit()
    log.info("admin %s set is_active=%s on user %s", admin.email, body.is_active, user.email)
    return {"ok": True, "isActive": user.is_active}


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = _target(db, admin, user_id, "delete")
    # Explicit deletes: SQLite (dev/tests) does not enforce ON DELETE CASCADE by default.
    db.execute(delete(Entry).where(Entry.user_id == user.id))
    db.execute(delete(UserSettings).where(UserSettings.user_id == user.id))
    db.delete(user)
    db.commit()
    log.info("admin %s deleted user %s", admin.email, user.email)


@router.post("/users/{user_id}/verify")
def force_verify(user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    user.email_verified = True
    db.commit()
    log.info("admin %s verified user %s", admin.email, user.email)
    return {"ok": True}


@router.post("/users/{user_id}/send-reset", status_code=status.HTTP_202_ACCEPTED)
def send_reset(
    user_id: int, tasks: BackgroundTasks, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    from .main import _send_reset  # imported here because main imports this module

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    tasks.add_task(_send_reset, user)
    log.info("admin %s sent a password reset to user %s", admin.email, user.email)
    return {"ok": True}
