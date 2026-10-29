"""The automatic news calendar: high and medium impact events from the free ForexFactory-style weekly JSON feeds.

The server downloads the feeds for everybody (one download serves all users, which keeps it inside the feed's limits) and
keeps the events in the database. A download happens lazily, when somebody asks for the calendar and the data is older
than CALENDAR_REFRESH_MIN, so it also works on hosts that sleep. If a download fails (the feed answers with an HTML "Request
Denied" page, the network is down, ...) the last good events stay and the next try waits CALENDAR_RETRY_MIN.

Each feed item looks like {"title", "country" (a currency code), "date" (ISO with a UTC offset), "impact", "forecast", "previous"}."""
import hashlib
import logging
import threading
import time
from datetime import datetime

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import config
from .db import SessionLocal, get_db
from .models import CalendarEvent, User
from .security import current_user

log = logging.getLogger("tradeguard.calendar")

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

KEEP_IMPACTS = {"high", "medium"}  # low-impact events and holidays are noise for a lock
KEEP_DAYS = 14  # events older than this are removed
_lock = threading.Lock()
_last_attempt_ms = 0


def _now_ms() -> int:
    return int(time.time() * 1000)


def parse_feed(data) -> tuple[list[dict], int | None]:
    """Turns one downloaded feed into events. Returns (high and medium impact events, time of the earliest item of any
    impact, or None). Items that are malformed are skipped. Raises ValueError if the data is not a feed at all."""
    if not isinstance(data, list):
        raise ValueError("The calendar feed is not a list")
    events, earliest = [], None
    for item in data:
        try:
            when = datetime.fromisoformat(str(item["date"]))
            if when.tzinfo is None:
                continue  # without an offset the moment is a guess
            at = int(when.timestamp() * 1000)
            earliest = at if earliest is None else min(earliest, at)
            impact = str(item["impact"]).strip().lower()
            if impact not in KEEP_IMPACTS:
                continue
            title = str(item["title"]).strip()[:200]
            currency = str(item["country"]).strip().upper()[:8]
            if not title or not currency:
                continue
            events.append({
                "id": hashlib.sha1(f"{at}|{currency}|{title}".encode()).hexdigest()[:24],
                "at": at, "currency": currency, "title": title, "impact": impact,
                "forecast": str(item.get("forecast") or "")[:30], "previous": str(item.get("previous") or "")[:30],
            })
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
    return events, earliest


def fetch_json(url: str):
    """Downloads one feed. Raises on any problem, including an HTML answer instead of JSON."""
    res = httpx.get(url, timeout=15, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (TradeGuard calendar)"})
    res.raise_for_status()
    return res.json()


def refresh(db: Session) -> int:
    """Downloads every feed and stores the events. Returns how many events were stored. Raises if no feed worked, so the
    stored events stay as they were (a missing next-week feed is normal early in the week and is not an error)."""
    events, earliest, worked = [], None, 0
    for url in config.CALENDAR_URLS:
        try:
            got, first = parse_feed(fetch_json(url))
        except Exception as err:
            log.warning("Calendar feed %s unavailable: %s", url, err)
            continue
        worked += 1
        events += got
        if first is not None:
            earliest = first if earliest is None else min(earliest, first)
    if not worked:
        raise RuntimeError("No calendar feed could be downloaded")

    now = _now_ms()
    unique = {e["id"]: e for e in events}
    for e in unique.values():
        db.merge(CalendarEvent(**e, seen_at=now))
    db.flush()  # the sessions do not autoflush: write the new seen_at values before the deletes below look at them
    if earliest is not None:  # an event that the feeds no longer list (rescheduled or removed) stops locking
        db.execute(delete(CalendarEvent).where(CalendarEvent.at >= earliest, CalendarEvent.seen_at < now))
    db.execute(delete(CalendarEvent).where(CalendarEvent.at < now - KEEP_DAYS * 86400000))
    db.commit()
    return len(unique)


def _refresh_in_own_session() -> None:
    try:
        with SessionLocal() as db:
            count = refresh(db)
        log.info("Calendar refreshed: %d events", count)
    except Exception:
        log.exception("Could not refresh the news calendar; keeping the last good events")


def _updated_at(db: Session) -> int | None:
    return db.scalar(select(func.max(CalendarEvent.seen_at)))


def ensure_fresh(db: Session, background: BackgroundTasks) -> None:
    """Starts a download when the stored events are stale. The first ever download is done now, so the first caller gets
    data; later ones run in the background so nobody waits for the feed."""
    global _last_attempt_ms
    if not config.CALENDAR_ENABLED:
        return
    now = _now_ms()
    updated = _updated_at(db)
    stale = updated is None or now - updated > config.CALENDAR_REFRESH_MIN * 60000
    with _lock:
        if not stale or now - _last_attempt_ms < config.CALENDAR_RETRY_MIN * 60000:
            return
        _last_attempt_ms = now
    if updated is None:
        _refresh_in_own_session()
    else:
        background.add_task(_refresh_in_own_session)


@router.get("")
def get_calendar(background: BackgroundTasks, _: User = Depends(current_user), db: Session = Depends(get_db)):
    """Upcoming events (and the last day's). `updatedAt` is when the data was last downloaded, None if never."""
    ensure_fresh(db, background)
    now = _now_ms()
    rows = db.scalars(
        select(CalendarEvent).where(CalendarEvent.at >= now - 86400000, CalendarEvent.at <= now + KEEP_DAYS * 86400000).order_by(CalendarEvent.at)
    ).all()
    return {
        "enabled": config.CALENDAR_ENABLED,
        "updatedAt": _updated_at(db),
        "events": [
            {"at": r.at, "currency": r.currency, "title": r.title, "impact": r.impact, "forecast": r.forecast, "previous": r.previous}
            for r in rows
        ],
    }
