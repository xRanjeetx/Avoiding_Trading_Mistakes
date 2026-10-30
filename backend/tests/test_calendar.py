import time
from datetime import datetime, timedelta, timezone

import pytest
from conftest import signup
from sqlalchemy import select

from app.core import config
from app.routers import news_calendar
from app.core.db import SessionLocal
from app.models import CalendarEvent


T0 = int(time.time()) * 1000  # fixed for the whole run, so the same fake event keeps the same time (and id) in every download


def iso(ms_from_now: int) -> str:
    """A feed-style timestamp (New York offset) for a moment `ms_from_now` after T0."""
    ny = timezone(timedelta(hours=-4))
    return datetime.fromtimestamp((T0 + ms_from_now) / 1000, ny).isoformat()


HOUR = 3_600_000


def item(title, hours, impact="High", country="USD", **extra):
    return {"title": title, "country": country, "date": iso(hours * HOUR), "impact": impact, "forecast": "1%", "previous": "2%", **extra}


@pytest.fixture()
def feed(monkeypatch):
    """Turns the calendar on with a fake download. Set feed.pages = {url: data or an Exception}; feed.calls counts downloads."""
    class Feed:
        pages = {}
        calls = 0

    f = Feed()
    urls = ["http://feed.test/this.json", "http://feed.test/next.json"]
    monkeypatch.setattr(config, "CALENDAR_ENABLED", True)
    monkeypatch.setattr(config, "CALENDAR_URLS", urls)
    monkeypatch.setattr(news_calendar, "_last_attempt_ms", 0)

    def fake(url):
        f.calls += 1
        got = f.pages[url]
        if isinstance(got, Exception):
            raise got
        return got

    monkeypatch.setattr(news_calendar, "fetch_json", fake)
    f.urls = urls
    return f


def stored():
    with SessionLocal() as db:
        return list(db.scalars(select(CalendarEvent).order_by(CalendarEvent.at)))


# ---------------- parsing ----------------
def test_parse_keeps_high_and_medium_only_and_reads_the_offset():
    data = [
        {"title": "FOMC Statement", "country": "usd", "date": "2026-10-28T14:00:00-04:00", "impact": "High", "forecast": "", "previous": ""},
        {"title": "Retail Sales", "country": "GBP", "date": "2026-10-28T07:00:00+00:00", "impact": "Medium", "forecast": "0.4%", "previous": "0.2%"},
        {"title": "Minor Data", "country": "EUR", "date": "2026-10-28T08:00:00-04:00", "impact": "Low"},
        {"title": "Bank Holiday", "country": "NZD", "date": "2026-10-25T15:00:00-04:00", "impact": "Holiday"},
    ]
    events, earliest = news_calendar.parse_feed(data)
    assert [e["title"] for e in events] == ["FOMC Statement", "Retail Sales"]
    assert events[0]["at"] == int(datetime(2026, 10, 28, 18, 0, tzinfo=timezone.utc).timestamp() * 1000)  # 14:00 at UTC-4
    assert events[0]["currency"] == "USD" and events[0]["impact"] == "high"
    assert events[1]["forecast"] == "0.4%"
    assert earliest == int(datetime(2026, 10, 25, 19, 0, tzinfo=timezone.utc).timestamp() * 1000)  # the holiday, any impact


def test_parse_skips_malformed_items_without_failing():
    bad = [None, 5, {}, {"title": "x"}, {"title": "A", "country": "USD", "date": "not a date", "impact": "High"},
           {"title": "No offset", "country": "USD", "date": "2026-10-28T14:00:00", "impact": "High"},
           {"title": "", "country": "USD", "date": "2026-10-28T14:00:00-04:00", "impact": "High"},
           {"title": "Good", "country": "USD", "date": "2026-10-28T14:00:00-04:00", "impact": "High"}]
    events, _ = news_calendar.parse_feed(bad)
    assert [e["title"] for e in events] == ["Good"]


def test_parse_rejects_something_that_is_not_a_feed():
    for junk in ({"error": "Request Denied"}, "<html>Request Denied</html>", None, 7):
        with pytest.raises(ValueError):
            news_calendar.parse_feed(junk)


def test_event_ids_are_stable_and_distinct():
    a, _ = news_calendar.parse_feed([{"title": "CPI", "country": "USD", "date": "2026-10-28T14:00:00-04:00", "impact": "High"}])
    b, _ = news_calendar.parse_feed([{"title": "CPI", "country": "USD", "date": "2026-10-28T14:00:00-04:00", "impact": "High"}])
    c, _ = news_calendar.parse_feed([{"title": "CPI", "country": "EUR", "date": "2026-10-28T14:00:00-04:00", "impact": "High"}])
    assert a[0]["id"] == b[0]["id"] != c[0]["id"]


# ---------------- refresh ----------------
def test_refresh_stores_events_and_a_second_refresh_does_not_duplicate(client, feed):
    feed.pages = {feed.urls[0]: [item("FOMC", 5), item("NFP", 30), item("Minor", 6, impact="Low")], feed.urls[1]: []}
    with SessionLocal() as db:
        assert news_calendar.refresh(db) == 2
        assert news_calendar.refresh(db) == 2
    assert [e.title for e in stored()] == ["FOMC", "NFP"]


def test_a_rescheduled_or_removed_event_stops_locking(client, feed):
    feed.pages = {feed.urls[0]: [item("Early", 2), item("FOMC", 5), item("NFP", 30)], feed.urls[1]: []}
    with SessionLocal() as db:
        news_calendar.refresh(db)
        feed.pages[feed.urls[0]] = [item("Early", 2), item("NFP", 30)]  # FOMC is gone
        news_calendar.refresh(db)
    assert [e.title for e in stored()] == ["Early", "NFP"]


def test_a_failed_download_keeps_the_last_good_events(client, feed):
    feed.pages = {feed.urls[0]: [item("FOMC", 5)], feed.urls[1]: []}
    with SessionLocal() as db:
        news_calendar.refresh(db)
        feed.pages = {u: ValueError("Request Denied") for u in feed.urls}  # e.g. the feed answers with an HTML page
        with pytest.raises(RuntimeError):
            news_calendar.refresh(db)
    assert [e.title for e in stored()] == ["FOMC"]


def test_one_missing_feed_is_fine_as_long_as_another_worked(client, feed):
    feed.pages = {feed.urls[0]: [item("FOMC", 5)], feed.urls[1]: RuntimeError("404")}
    with SessionLocal() as db:
        assert news_calendar.refresh(db) == 1


def test_old_events_are_removed(client, feed):
    with SessionLocal() as db:
        db.add(CalendarEvent(id="old", at=int(time.time() * 1000) - 20 * 24 * HOUR, currency="USD", title="Ancient", impact="high", seen_at=1))
        db.commit()
        feed.pages = {feed.urls[0]: [item("FOMC", 5)], feed.urls[1]: []}
        news_calendar.refresh(db)
    assert [e.title for e in stored()] == ["FOMC"]


# ---------------- endpoint ----------------
def test_calendar_needs_a_login(client):
    assert client.get("/api/calendar").status_code == 401


def test_calendar_is_empty_when_switched_off(client):
    h = signup(client)
    assert client.get("/api/calendar", headers=h).json() == {"enabled": False, "updatedAt": None, "events": []}


def test_first_request_downloads_and_returns_the_events(client, feed):
    feed.pages = {feed.urls[0]: [item("NFP", 30), item("FOMC", 5, forecast="4.00%")], feed.urls[1]: []}
    h = signup(client)
    got = client.get("/api/calendar", headers=h).json()
    assert got["enabled"] is True and got["updatedAt"] > 0
    assert [e["title"] for e in got["events"]] == ["FOMC", "NFP"]  # sorted by time
    assert got["events"][0] | {"at": 0} == {"at": 0, "currency": "USD", "title": "FOMC", "impact": "high", "forecast": "4.00%", "previous": "2%"}


def test_events_at_the_same_time_come_back_in_a_fixed_order(client, feed):
    """Equal times used to come back in whatever order the database chose, so the News tab could reorder between loads."""
    titles = ["FOMC Statement", "Federal Funds Rate", "ecb speech", "Zebra", "BOJ Rate"]
    feed.pages = {feed.urls[0]: [item(t, 5) for t in titles], feed.urls[1]: []}
    h = signup(client)
    first = [e["title"] for e in client.get("/api/calendar", headers=h).json()["events"]]
    assert first == ["BOJ Rate", "ecb speech", "Federal Funds Rate", "FOMC Statement", "Zebra"]  # title, ignoring case
    assert [e["title"] for e in client.get("/api/calendar", headers=h).json()["events"]] == first


def test_events_far_in_the_past_or_future_are_not_returned(client, feed):
    feed.pages = {feed.urls[0]: [item("Soon", 5), item("Far", 24 * 20), item("Yesterday long ago", -24 * 3)], feed.urls[1]: []}
    h = signup(client)
    assert [e["title"] for e in client.get("/api/calendar", headers=h).json()["events"]] == ["Soon"]


def test_the_feed_is_not_hit_again_while_the_data_is_fresh(client, feed):
    feed.pages = {feed.urls[0]: [item("FOMC", 5)], feed.urls[1]: []}
    h = signup(client)
    client.get("/api/calendar", headers=h)
    calls = feed.calls
    for _ in range(3):
        client.get("/api/calendar", headers=h)
    assert feed.calls == calls


def test_stale_data_is_refreshed_in_the_background_and_not_more_often_than_the_retry_wait(client, feed):
    feed.pages = {feed.urls[0]: [item("FOMC", 5)], feed.urls[1]: []}
    h = signup(client)
    client.get("/api/calendar", headers=h)
    with SessionLocal() as db:  # make the stored data look 2 hours old
        for e in db.scalars(select(CalendarEvent)):
            e.seen_at -= 2 * HOUR
        db.commit()
    news_calendar._last_attempt_ms = 0
    feed.pages = {feed.urls[0]: [item("FOMC", 5), item("NFP", 30)], feed.urls[1]: []}
    before = feed.calls
    client.get("/api/calendar", headers=h)  # triggers the refresh after answering
    assert feed.calls == before + 2
    assert [e["title"] for e in client.get("/api/calendar", headers=h).json()["events"]] == ["FOMC", "NFP"]
    calls = feed.calls
    client.get("/api/calendar", headers=h)
    assert feed.calls == calls


def test_a_failing_feed_is_retried_only_after_the_wait(client, feed):
    feed.pages = {u: ValueError("Request Denied") for u in feed.urls}
    h = signup(client)
    assert client.get("/api/calendar", headers=h).json()["updatedAt"] is None  # nothing downloaded, nothing stored
    calls = feed.calls
    client.get("/api/calendar", headers=h)
    client.get("/api/calendar", headers=h)
    assert feed.calls == calls  # not hammering the feed


# ---------------- settings ----------------
def test_news_settings_default_to_auto_with_high_impact_only(client):
    h = signup(client)
    news = client.get("/api/settings", headers=h).json()["news"]
    assert news == {"leadMin": 120, "auto": True, "includeMedium": True, "events": []}


def test_news_settings_roundtrip(client):
    h = signup(client)
    s = client.get("/api/settings", headers=h).json()
    s["news"] = {"leadMin": 45, "auto": False, "includeMedium": True, "events": []}
    assert client.put("/api/settings", json=s, headers=h).json()["news"] == s["news"]
