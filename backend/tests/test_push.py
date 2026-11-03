from datetime import datetime, timezone

from app.core import config
from app.core.db import SessionLocal
from app.models import Entry, PushSubscription
from app.services import push
from conftest import signup

PREFS = {"on": True, "lead": 5, "closeLead": 5, "longMin": 120, "tz": "UTC"}
SUB = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {"p256dh": "k", "auth": "a"}, "prefs": PREFS}


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def test_session_open_and_close_reminders_match_the_app():
    # Tuesday 2026-11-03: New York is on EST (UTC-5), so London 02:00 NY is 07:00 UTC.
    prefs = push.clean_prefs(PREFS)
    opens = push.due_reminders([], None, prefs, utc(2026, 11, 3, 6, 57))
    assert opens == [{"key": "open:london:2026-11-03", "title": "London session opens in 3m",
                      "body": "Open the checklist, clear your head and wait for your setup."}]
    closes = push.due_reminders([], None, prefs, utc(2026, 11, 3, 9, 57))  # 04:57 NY, London ends 05:00
    assert [r["key"] for r in closes] == ["close:london:2026-11-03"]
    assert push.due_reminders([], None, prefs, utc(2026, 11, 3, 8, 0)) == []
    assert push.due_reminders([], None, push.clean_prefs({**PREFS, "on": False}), utc(2026, 11, 3, 6, 57)) == []


def test_no_reminders_in_the_weekend_gap():
    prefs = push.clean_prefs(PREFS)
    assert push.due_reminders([], None, prefs, utc(2026, 11, 7, 6, 57)) == []  # Saturday


def test_open_trade_reminder_has_the_ctc_price():
    e = Entry(user_id=1, id="t1", timestamp=0, pair="EURUSD", dir="buy", entry=1.085, sl=1.08, traded=True, result="open")
    now = utc(1970, 1, 1, 2, 30)  # 150 minutes later
    [r] = [x for x in push.due_reminders([e], [], push.clean_prefs(PREFS), now) if x["key"].startswith("long:")]
    assert r["key"] == "long:t1:1"
    assert r["title"] == "EURUSD BUY open for 2h 30m"
    assert "(1.0925)" in r["body"]


def test_subscribe_validates_and_is_per_user(client):
    h = signup(client)
    assert client.get("/api/push/key", headers=h).json() == {"publicKey": ""}  # no VAPID keys in tests
    assert client.put("/api/push/subscription", json=SUB, headers=h).status_code == 503


def test_subscription_roundtrip_and_send(client, monkeypatch):
    monkeypatch.setattr(config, "PUSH_ENABLED", True)
    monkeypatch.setattr(config, "VAPID_PUBLIC_KEY", "PUB")
    h = signup(client)
    assert client.get("/api/push/key", headers=h).json() == {"publicKey": "PUB"}
    assert client.put("/api/push/subscription", json={**SUB, "endpoint": "https://evil.example.com/x"}, headers=h).status_code == 400
    assert client.put("/api/push/subscription", json=SUB, headers=h).status_code == 204
    assert client.put("/api/push/subscription", json={**SUB, "prefs": {**PREFS, "lead": 10}}, headers=h).status_code == 204  # update, not duplicate

    calls = []
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 1
        assert db.query(PushSubscription).one().prefs["lead"] == 10
        sent = push.send_due(db, utc(2026, 11, 3, 6, 57), sender=lambda s, p: calls.append(p) or True)
        again = push.send_due(db, utc(2026, 11, 3, 6, 58), sender=lambda s, p: calls.append(p) or True)
    assert (sent, again) == (1, 0)  # each reminder goes out once
    assert calls[0]["tag"] == "open:london:2026-11-03"

    with SessionLocal() as db:  # a device the push service no longer knows is removed
        push.send_due(db, utc(2026, 11, 4, 6, 57), sender=lambda s, p: False)
        assert db.query(PushSubscription).count() == 0


def test_unsubscribe(client, monkeypatch):
    monkeypatch.setattr(config, "PUSH_ENABLED", True)
    h, other = signup(client), signup(client, "bobby")
    client.put("/api/push/subscription", json=SUB, headers=h)
    client.post("/api/push/unsubscribe", json={"endpoint": SUB["endpoint"]}, headers=other)  # not theirs
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 1
    assert client.post("/api/push/unsubscribe", json={"endpoint": SUB["endpoint"]}, headers=h).status_code == 204
    with SessionLocal() as db:
        assert db.query(PushSubscription).count() == 0
