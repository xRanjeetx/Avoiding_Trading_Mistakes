"""Reminders pushed to phones and browsers while the app is closed (Web Push).

This is the server side of frontend/src/lib/reminders.js: the same three reminders (a session about to open, a session about
to close, a trade open for too long), worked out from the user's saved settings and journal and the device's own reminder
preferences. A background thread checks every PUSH_TICK_SECONDS. Reminder keys match the app's, and a notification's tag is
its key, so a device with the app open shows each reminder once, not twice."""
import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core import config
from ..core.db import SessionLocal
from ..models import Entry, PushSubscription, UserSettings
from ..schemas import DEFAULT_KILLZONES

log = logging.getLogger("tradeguard.push")

PUSH_TICK_SECONDS = 30
NY = ZoneInfo("America/New_York")
NAMES = {"asian": "Asian", "london": "London", "newyork": "New York", "londonclose": "London Close"}
CTC_RR = 1.5  # keep equal to CTC_RR in frontend/src/lib/rules.js
DEFAULT_PREFS = {"on": False, "lead": 5, "closeLead": 5, "longMin": 120}
# Only the push services of the big browsers. The server posts to the stored address, so it must never be one of the user's choosing.
ALLOWED_HOST_SUFFIXES = (".googleapis.com", ".mozilla.com", ".apple.com", ".windows.com")


def endpoint_allowed(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(host.endswith(s) for s in ALLOWED_HOST_SUFFIXES)


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _clamp(v, lo, hi, fallback):
    try:
        n = round(float(v))
    except (TypeError, ValueError):
        return fallback
    return min(hi, max(lo, n))


def clean_prefs(raw: dict | None) -> dict:
    raw = raw or {}
    tz = raw.get("tz")
    try:
        ZoneInfo(tz)
    except Exception:
        tz = "UTC"
    return {
        "on": raw.get("on") is True,
        "lead": _clamp(raw.get("lead"), 1, 60, DEFAULT_PREFS["lead"]),
        "closeLead": _clamp(raw.get("closeLead"), 1, 60, DEFAULT_PREFS["closeLead"]),
        "longMin": _clamp(raw.get("longMin"), 5, 1440, DEFAULT_PREFS["longMin"]),
        "tz": tz,
    }


# ---------- the forex week and the sessions (port of lib/killzones.js) ----------
def _ny(now: datetime) -> tuple[int, int]:
    """(weekday with 0 = Sunday, minutes after midnight) on the New York clock."""
    local = now.astimezone(NY)
    return (local.weekday() + 1) % 7, local.hour * 60 + local.minute


def _closed(day: int, minutes: int) -> bool:
    return day == 6 or (day == 5 and minutes >= 17 * 60) or (day == 0 and minutes < 17 * 60)


def _in_range(n: int, s: int, e: int) -> bool:
    return s <= n < e if s <= e else n >= s or n < e


def normalize_killzones(saved) -> list[dict]:
    by_key = {z.get("key"): z for z in (saved if isinstance(saved, list) else []) if isinstance(z, dict)}
    out = []
    for d in DEFAULT_KILLZONES:
        z = by_key.get(d["key"], {})
        out.append({"key": d["key"], "start": z.get("start", d["start"]), "end": z.get("end", d["end"]), "on": z.get("on", d["on"])})
    return out


def _next_zone(zones: list[dict], now: datetime):
    day, n = _ny(now)
    best = None
    for ahead in range(8):
        for z in zones:
            if not z["on"]:
                continue
            start = _minutes(z["start"])
            in_min = ahead * 1440 + start - n
            if in_min <= 0 or _closed((day + ahead) % 7, start):
                continue
            if best is None or in_min < best[1]:
                best = (z, in_min)
        if best:
            break
    return best


def fmt_duration(minutes: int) -> str:
    d, h, m = minutes // 1440, minutes % 1440 // 60, minutes % 60
    if d:
        return f"{d}d {h}h" if h else f"{d}d"
    if h:
        return f"{h}h {m}m" if m else f"{h}h"
    return f"{m}m"


def _places(n: float) -> int:
    text = repr(float(n))
    return len(text.split(".")[1].rstrip("0")) if "." in text else 0


def ctc_price(e: Entry) -> str | None:
    if e.entry is None or e.sl is None or e.entry == e.sl or not e.dir:
        return None
    sign = 1 if e.dir == "buy" else -1
    decimals = max(2, _places(e.entry), _places(e.sl))
    price = f"{e.entry + sign * CTC_RR * abs(e.entry - e.sl):.{decimals + 1}f}"
    return price[:-1] if price.endswith("0") else price


def due_reminders(entries: list[Entry], killzones, prefs: dict, now: datetime) -> list[dict]:
    """[{key, title, body}] due right now, with the same keys, titles and texts as dueReminders() in the app."""
    if not prefs["on"]:
        return []
    zones = normalize_killzones(killzones)
    tz = ZoneInfo(prefs["tz"])
    out = []

    nxt = _next_zone(zones, now)
    if nxt and nxt[1] <= prefs["lead"]:
        z, in_min = nxt
        opens = (now + timedelta(minutes=in_min)).astimezone(tz).strftime("%Y-%m-%d")
        out.append({
            "key": f"open:{z['key']}:{opens}",
            "title": f"{NAMES[z['key']]} session opens in {fmt_duration(in_min)}",
            "body": "Open the checklist, clear your head and wait for your setup.",
        })

    day, n = _ny(now)
    if not _closed(day, n):
        for z in zones:
            if not (z["on"] and _in_range(n, _minutes(z["start"]), _minutes(z["end"]))):
                continue
            left = ((_minutes(z["end"]) - n + 1440) % 1440) or 1440
            if left > prefs["closeLead"]:
                continue
            closes = (now + timedelta(minutes=left)).astimezone(tz).strftime("%Y-%m-%d")
            out.append({
                "key": f"close:{z['key']}:{closes}",
                "title": f"{NAMES[z['key']]} session closes in {fmt_duration(left)}",
                "body": "Protect or close your open trades. Do not start a new one this close to the end.",
            })

    long_ms = prefs["longMin"] * 60000
    now_ms = int(now.timestamp() * 1000)
    for e in entries:
        if not e.traded or e.result != "open":
            continue
        age = now_ms - e.timestamp
        if age < long_ms:
            continue
        price = ctc_price(e)
        label = " ".join(x for x in (e.pair, e.dir.upper() if e.dir else "") if x) or "Trade"
        hint = f" ({price})" if price else ""
        out.append({
            "key": f"long:{e.id}:{age // long_ms}",
            "title": f"{label} open for {fmt_duration(age // 60000)}",
            "body": f"If price reached {CTC_RR} RR{hint}, move your SL to cost (CTC). Otherwise stay with the plan.",
        })
    return out


# ---------- sending ----------
def _send_one(sub: PushSubscription, payload: dict) -> bool | None:
    """True = sent, False = the device is gone (remove it), None = failed for now (try again later)."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload),
            vapid_private_key=config.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": config.VAPID_SUBJECT},
            ttl=600,  # a reminder that is ten minutes old is no longer useful
            timeout=10,
        )
        return True
    except WebPushException as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (404, 410):
            return False
        log.warning("Push to a device failed (%s): %s", status, exc)
    except Exception:
        log.exception("Push to a device failed")
    return None


def send_due(db: Session, now: datetime | None = None, sender=_send_one) -> int:
    """Pushes every reminder that is due and not yet sent. Returns how many notifications went out."""
    now = now or datetime.now(timezone.utc)
    sent_count = 0
    settings_cache: dict[int, UserSettings | None] = {}
    entries_cache: dict[int, list[Entry]] = {}
    for sub in db.scalars(select(PushSubscription)).all():
        prefs = clean_prefs(sub.prefs)
        if not prefs["on"]:
            continue
        if sub.user_id not in settings_cache:
            settings_cache[sub.user_id] = db.get(UserSettings, sub.user_id)
            entries_cache[sub.user_id] = list(db.scalars(
                select(Entry).where(Entry.user_id == sub.user_id, Entry.traded.is_(True), Entry.result == "open")
            ))
        row = settings_cache[sub.user_id]
        done = list(sub.sent or [])
        sent_now = False
        for r in due_reminders(entries_cache[sub.user_id], row.killzones if row else None, prefs, now):
            if r["key"] in done:
                continue
            outcome = sender(sub, {"title": r["title"], "body": r["body"], "tag": r["key"]})
            if outcome is False:
                db.delete(sub)
                sent_now = False
                break
            if outcome:
                done.append(r["key"])
                sent_count += 1
                sent_now = True
        if sent_now:
            sub.sent = done[-60:]
    db.commit()
    return sent_count


_started = False


def start_scheduler() -> None:
    """Starts the sender thread once. Does nothing when push is not configured or switched off."""
    global _started
    if _started or not (config.PUSH_ENABLED and config.PUSH_SCHEDULER):
        return
    _started = True

    def loop() -> None:
        stop = threading.Event()
        while not stop.wait(PUSH_TICK_SECONDS):
            try:
                with SessionLocal() as db:
                    send_due(db)
            except Exception:
                log.exception("Push reminder check failed")

    threading.Thread(target=loop, name="push-reminders", daemon=True).start()
    log.info("Push reminders are on")
