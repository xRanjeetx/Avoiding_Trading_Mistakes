"""Edge cases and realistic flows. Run on SQLite by default, or the real PostgreSQL with TEST_DB=postgres."""
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app import config
from app.schemas import DEFAULT_KILLZONES, DEFAULT_PAIRS
from conftest import signup

NOW = 1_760_000_000_000


def trade(**over):
    body = {
        "timestamp": NOW, "pair": "XAUUSD", "dir": "buy", "setup": "fvg", "lot": 0.02,
        "entry": 2340.5, "sl": 2338.5, "tp": 2344.5, "rr": 2.0,
        "answers": {"1": True, "7": True, "13": True}, "failedRules": [], "traded": True,
        "result": "open", "notes": "5m FVG retest", "lesson": "",
    }
    body.update(over)
    return body


# ---------------- health and auth ----------------
def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_register_returns_working_token_and_normalises_email(client):
    r = client.post("/api/auth/register", json={"email": "Trader@Example.COM", "password": "password123"})
    assert r.status_code == 201
    assert r.json()["email"] == "trader@example.com"
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert client.get("/api/settings", headers=h).status_code == 200


def test_login_is_case_insensitive_and_wrong_password_rejected(client):
    signup(client, "alice")
    assert client.post("/api/auth/login", json={"email": "ALICE@example.com", "password": "password123"}).status_code == 200
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "password124"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "password123"}).status_code == 401


@pytest.mark.parametrize("email", ["", "plain", "a@b", "a b@c.com", "@c.com", "a@.com", "x" * 250 + "@a.com"])
def test_register_rejects_bad_emails(client, email):
    assert client.post("/api/auth/register", json={"email": email, "password": "password123"}).status_code == 422


@pytest.mark.parametrize("pw", ["", "short", "1234567", "x" * 73])
def test_register_rejects_bad_passwords(client, pw):
    assert client.post("/api/auth/register", json={"email": "a@b.co", "password": pw}).status_code == 422


def test_password_boundaries_accepted(client):
    assert client.post("/api/auth/register", json={"email": "a8@b.co", "password": "12345678"}).status_code == 201
    assert client.post("/api/auth/register", json={"email": "a72@b.co", "password": "x" * 72}).status_code == 201


def test_unicode_password_over_72_bytes_is_rejected(client):
    # bcrypt only sees the first 72 BYTES. 40 two-byte characters = 80 bytes would be silently truncated,
    # so two different passwords could log into the same account.
    r = client.post("/api/auth/register", json={"email": "u@b.co", "password": "é" * 40})
    assert r.status_code == 422


def test_unicode_password_truncation_does_not_allow_wrong_password(client):
    client.post("/api/auth/register", json={"email": "u2@b.co", "password": "é" * 36})  # exactly 72 bytes
    bad = client.post("/api/auth/login", json={"email": "u2@b.co", "password": "é" * 36 + "X"})
    assert bad.status_code in (401, 422)


def test_registration_can_be_closed(client, monkeypatch):
    monkeypatch.setattr(config, "ALLOW_REGISTRATION", False)
    r = client.post("/api/auth/register", json={"email": "a@b.co", "password": "password123"})
    assert r.status_code == 403


def test_duplicate_email_conflict_and_account_still_usable(client):
    signup(client, "alice")
    assert client.post("/api/auth/register", json={"email": "alice@example.com", "password": "otherpass12"}).status_code == 409
    # the original password still works, the failed duplicate did not overwrite it
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "password123"}).status_code == 200


def test_missing_and_garbage_tokens_are_401(client):
    assert client.get("/api/entries").status_code == 401
    for bad in ["", "abc", "Bearer", "Bearer abc.def.ghi"]:
        r = client.get("/api/entries", headers={"Authorization": bad})
        assert r.status_code == 401


def test_expired_and_forged_tokens_are_rejected(client):
    h = signup(client)
    uid = jwt.decode(h["Authorization"].split()[1], config.SECRET_KEY, algorithms=["HS256"])["sub"]
    expired = jwt.encode({"sub": uid, "exp": datetime.now(timezone.utc) - timedelta(seconds=5)}, config.SECRET_KEY, algorithm="HS256")
    forged = jwt.encode({"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(days=1)}, "wrong-secret", algorithm="HS256")
    none_alg = jwt.encode({"sub": uid}, None, algorithm="none")
    for tok in (expired, forged, none_alg):
        assert client.get("/api/entries", headers={"Authorization": f"Bearer {tok}"}).status_code == 401


def test_token_for_deleted_or_unknown_user_is_401(client):
    ghost = jwt.encode({"sub": "99999", "exp": datetime.now(timezone.utc) + timedelta(days=1)}, config.SECRET_KEY, algorithm="HS256")
    assert client.get("/api/settings", headers={"Authorization": f"Bearer {ghost}"}).status_code == 401
    notnum = jwt.encode({"sub": "abc", "exp": datetime.now(timezone.utc) + timedelta(days=1)}, config.SECRET_KEY, algorithm="HS256")
    assert client.get("/api/settings", headers={"Authorization": f"Bearer {notnum}"}).status_code == 401


# ---------------- settings ----------------
def test_settings_defaults_and_full_roundtrip(client, auth):
    s = client.get("/api/settings", headers=auth).json()
    assert s == {"lot": 0.02, "minRR": 2, "maxTrades": 4, "maxSL": 4, "balance": 0, "currency": "$",
                 "killzones": DEFAULT_KILLZONES, "pairs": DEFAULT_PAIRS}
    new = {**s, "lot": 0.1, "minRR": 1.5, "maxTrades": 2, "maxSL": 1, "balance": 5000.5, "currency": "€"}
    assert client.put("/api/settings", json=new, headers=auth).json() == new
    assert client.get("/api/settings", headers=auth).json() == new


def test_pairs_default_edit_and_validation(client, auth):
    s = client.get("/api/settings", headers=auth).json()
    assert {"pair": "EURUSD", "lot": 0.2} in s["pairs"]
    pairs = [*s["pairs"], {"pair": "GBPUSD", "lot": 0.1}]
    assert client.put("/api/settings", json={**s, "pairs": pairs}, headers=auth).json()["pairs"] == pairs
    for bad in ([{"pair": "EURUSD", "lot": 0.2}] * 2, [{"pair": "eur usd", "lot": 1}], [{"pair": "EURUSD", "lot": 0}]):
        assert client.put("/api/settings", json={**s, "pairs": bad}, headers=auth).status_code == 422


# ---------------- killzones ----------------
def test_killzone_defaults_match_the_new_york_sessions(client, auth):
    zones = {z["key"]: (z["start"], z["end"]) for z in client.get("/api/settings", headers=auth).json()["killzones"]}
    assert zones == {"asian": ("20:00", "00:00"), "london": ("02:00", "05:00"),
                     "newyork": ("07:00", "10:00"), "londonclose": ("10:00", "12:00")}


def test_killzones_can_be_edited_and_switched_off(client, auth):
    s = client.get("/api/settings", headers=auth).json()
    zones = [{**z} for z in s["killzones"]]
    zones[1].update(start="03:00", end="06:30", on=False, color="#112233")
    saved = client.put("/api/settings", json={**s, "killzones": zones}, headers=auth).json()
    assert saved["killzones"] == zones
    assert client.get("/api/settings", headers=auth).json()["killzones"] == zones


@pytest.mark.parametrize("change", [
    {"start": "25:00"}, {"end": "9:00"}, {"color": "red"}, {"color": "#12345"}, {"key": "tokyo"}, {"on": "maybe"},
])
def test_killzone_validation(client, auth, change):
    s = client.get("/api/settings", headers=auth).json()
    zones = [{**s["killzones"][0], **change}, *s["killzones"][1:]]
    assert client.put("/api/settings", json={**s, "killzones": zones}, headers=auth).status_code == 422


def test_killzones_reject_duplicates_and_too_many(client, auth):
    s = client.get("/api/settings", headers=auth).json()
    dup = [s["killzones"][0], s["killzones"][0]]
    assert client.put("/api/settings", json={**s, "killzones": dup}, headers=auth).status_code == 422
    too_many = s["killzones"] + [s["killzones"][0]]
    assert client.put("/api/settings", json={**s, "killzones": too_many}, headers=auth).status_code == 422


def test_killzones_are_per_user(client):
    a, b = signup(client, "alice"), signup(client, "bobby")
    s = client.get("/api/settings", headers=a).json()
    zones = [{**z, "on": False} for z in s["killzones"]]
    client.put("/api/settings", json={**s, "killzones": zones}, headers=a)
    assert all(z["on"] for z in client.get("/api/settings", headers=b).json()["killzones"])


def test_existing_database_gets_the_killzones_column():
    """A database created before killzones existed (like the live one) is upgraded in place, keeping its rows."""
    from sqlalchemy import create_engine, inspect, text
    from app.main import ensure_columns

    eng = create_engine("sqlite://")
    with eng.begin() as c:
        c.execute(text("create table user_settings (user_id integer primary key, lot float)"))
        c.execute(text("insert into user_settings values (1, 0.05)"))
        c.execute(text("create table users (id integer primary key, email text, password_hash text)"))
        c.execute(text("insert into users values (1, 'old@example.com', 'x')"))
    ensure_columns(eng)
    ensure_columns(eng)  # running it again is harmless
    assert "killzones" in {c["name"] for c in inspect(eng).get_columns("user_settings")}
    with eng.connect() as c:
        assert c.execute(text("select lot, killzones from user_settings")).one() == (0.05, None)
        # Accounts that predate email verification stay able to log in.
        assert c.execute(text("select email_verified from users")).scalar() in (1, True)


@pytest.mark.parametrize("patch", [
    {"lot": 0}, {"lot": -1}, {"minRR": 0}, {"maxTrades": 0}, {"maxSL": 0}, {"balance": -1},
    {"currency": "12345"}, {"maxTrades": 1.5},
])
def test_settings_validation(client, auth, patch):
    s = client.get("/api/settings", headers=auth).json()
    assert client.put("/api/settings", json={**s, **patch}, headers=auth).status_code == 422


@pytest.mark.parametrize("value", ["99:99", "24:00", "12:60", "25:30", "00:99"])
def test_settings_rejects_impossible_clock_times(client, auth, value):
    s = client.get("/api/settings", headers=auth).json()
    for key in ("start", "end"):
        zones = [{**s["killzones"][0], key: value}, *s["killzones"][1:]]
        assert client.put("/api/settings", json={**s, "killzones": zones}, headers=auth).status_code == 422


@pytest.mark.parametrize("value", ["00:00", "23:59", "12:30"])
def test_settings_accepts_valid_clock_times(client, auth, value):
    s = client.get("/api/settings", headers=auth).json()
    zones = [{**s["killzones"][0], "start": value}, *s["killzones"][1:]]
    assert client.put("/api/settings", json={**s, "killzones": zones}, headers=auth).status_code == 200


def test_old_clients_may_still_send_the_removed_session_fields(client, auth):
    """The London / My session times are gone; extra fields from an older app version are ignored, not an error."""
    s = client.get("/api/settings", headers=auth).json()
    old = {**s, "londonStart": "12:30", "londonEnd": "17:30", "sessionStart": "18:00", "sessionEnd": "22:30"}
    saved = client.put("/api/settings", json=old, headers=auth)
    assert saved.status_code == 200
    assert "londonStart" not in saved.json() and "sessionStart" not in saved.json()


def test_settings_are_per_user(client):
    a, b = signup(client, "alice"), signup(client, "bobby")
    s = client.get("/api/settings", headers=a).json()
    client.put("/api/settings", json={**s, "maxTrades": 9, "currency": "£"}, headers=a)
    other = client.get("/api/settings", headers=b).json()
    assert other["maxTrades"] == 4 and other["currency"] == "$"


# ---------------- entries ----------------
def test_full_trade_lifecycle(client, auth):
    created = client.post("/api/entries", json=trade(), headers=auth)
    assert created.status_code == 201
    e = created.json()
    assert len(e["id"]) == 32 and e["result"] == "open" and e["pnl"] is None and e["closedAt"] is None
    assert e["entry"] == 2340.5 and e["answers"] == {"1": True, "7": True, "13": True}

    closed = trade(result="tp", pnl=24.5, exit=2344.5, closedAt=NOW + 600_000, lesson="Waited for the FVG")
    up = client.put(f"/api/entries/{e['id']}", json=closed, headers=auth).json()
    assert (up["result"], up["pnl"], up["exit"], up["closedAt"], up["lesson"]) == ("tp", 24.5, 2344.5, NOW + 600_000, "Waited for the FVG")
    assert up["id"] == e["id"] and up["timestamp"] == NOW

    listed = client.get("/api/entries", headers=auth).json()
    assert len(listed) == 1 and listed[0] == up
    assert client.delete(f"/api/entries/{e['id']}", headers=auth).status_code == 204
    assert client.get("/api/entries", headers=auth).json() == []


def test_entries_listed_oldest_first(client, auth):
    for ts in (NOW + 3000, NOW + 1000, NOW + 2000):
        client.post("/api/entries", json=trade(timestamp=ts), headers=auth)
    assert [e["timestamp"] for e in client.get("/api/entries", headers=auth).json()] == [NOW + 1000, NOW + 2000, NOW + 3000]


def test_client_supplied_id_and_duplicate_id(client, auth):
    assert client.post("/api/entries", json=trade(id="trade-001"), headers=auth).json()["id"] == "trade-001"
    assert client.post("/api/entries", json=trade(id="trade-001"), headers=auth).status_code == 409


def test_same_entry_id_allowed_for_different_users(client):
    a, b = signup(client, "alice"), signup(client, "bobby")
    assert client.post("/api/entries", json=trade(id="same"), headers=a).status_code == 201
    assert client.post("/api/entries", json=trade(id="same"), headers=b).status_code == 201


def test_users_cannot_read_edit_or_delete_each_others_entries(client):
    a, b = signup(client, "alice"), signup(client, "bobby")
    eid = client.post("/api/entries", json=trade(), headers=a).json()["id"]
    assert client.get("/api/entries", headers=b).json() == []
    assert client.put(f"/api/entries/{eid}", json=trade(result="sl"), headers=b).status_code == 404
    assert client.delete(f"/api/entries/{eid}", headers=b).status_code == 404
    client.delete("/api/entries", headers=b)  # bobby wiping HIS data must not touch alice's
    assert client.get("/api/entries", headers=a).json()[0]["result"] == "open"


def test_missing_entry_is_404(client, auth):
    assert client.put("/api/entries/nope", json=trade(), headers=auth).status_code == 404
    assert client.delete("/api/entries/nope", headers=auth).status_code == 404


@pytest.mark.parametrize("patch", [
    {"timestamp": "yesterday"}, {"dir": "long"}, {"result": "won"}, {"lot": "big"}, {"answers": {"1": "maybe"}},
    {"failedRules": ["a"]}, {"pair": "X" * 31}, {"setup": "S" * 21}, {"id": "i" * 41}, {"traded": "perhaps"},
])
def test_entry_validation(client, auth, patch):
    assert client.post("/api/entries", json=trade(**patch), headers=auth).status_code == 422


def test_entry_requires_timestamp(client, auth):
    body = trade()
    del body["timestamp"]
    assert client.post("/api/entries", json=body, headers=auth).status_code == 422


def test_minimal_entry_gets_defaults(client, auth):
    e = client.post("/api/entries", json={"timestamp": NOW}, headers=auth).json()
    assert (e["pair"], e["dir"], e["result"], e["traded"], e["answers"], e["failedRules"], e["notes"]) == ("", None, "open", True, {}, [], "")


def test_unicode_and_long_text_roundtrip(client, auth):
    notes = "Setup ✓ — waited for 5m FVG 📈 «ça marche» " * 40
    e = client.post("/api/entries", json=trade(notes=notes, lesson="日本語のメモ"), headers=auth).json()
    got = client.get("/api/entries", headers=auth).json()[0]
    assert got["notes"] == notes and got["lesson"] == "日本語のメモ" and got["id"] == e["id"]


def test_negative_and_zero_pnl_roundtrip(client, auth):
    for pnl in (-12.34, 0.0):
        e = client.post("/api/entries", json=trade(result="sl" if pnl else "be", pnl=pnl), headers=auth).json()
        assert e["pnl"] == pnl


def test_float_precision_survives_roundtrip(client, auth):
    e = client.post("/api/entries", json=trade(entry=1.08765, sl=1.08665, tp=1.08965), headers=auth).json()
    assert (e["entry"], e["sl"], e["tp"]) == (1.08765, 1.08665, 1.08965)


def test_non_finite_numbers_are_rejected_not_500(client, auth):
    for raw in ('{"timestamp": 1, "pnl": NaN}', '{"timestamp": 1, "pnl": Infinity}', '{"timestamp": 1, "lot": -Infinity}'):
        r = client.post("/api/entries", content=raw, headers={**auth, "Content-Type": "application/json"})
        assert r.status_code == 422, (raw, r.status_code)


def test_absurd_timestamp_is_rejected_not_500(client, auth):
    for ts in (2**63, -(2**63) - 1, 10**30):
        r = client.post("/api/entries", json=trade(timestamp=ts), headers=auth)
        assert r.status_code == 422, (ts, r.status_code)
    assert client.post("/api/entries", json=trade(closedAt=2**70), headers=auth).status_code == 422


def test_entry_ids_with_slashes_or_spaces_are_rejected(client, auth):
    for bad in ["a/b", "a b", "../x", "x?y", "é"]:
        assert client.post("/api/entries", json=trade(id=bad), headers=auth).status_code == 422, bad


def test_validation_errors_do_not_echo_the_password(client):
    r = client.post("/api/auth/register", json={"email": "a@b.co", "password": "Zq9!x"})
    assert r.status_code == 422
    assert "Zq9" not in r.text
    d = r.json()["detail"]
    assert d and all(set(x) == {"type", "loc", "msg"} for x in d)


def test_malformed_json_is_422(client, auth):
    r = client.post("/api/entries", content="{not json", headers={**auth, "Content-Type": "application/json"})
    assert r.status_code == 422


def test_clear_all_only_clears_own_entries_and_keeps_settings(client):
    a, b = signup(client, "alice"), signup(client, "bobby")
    for h in (a, b):
        for ts in (1, 2, 3):
            client.post("/api/entries", json=trade(timestamp=ts), headers=h)
    s = client.get("/api/settings", headers=a).json()
    client.put("/api/settings", json={**s, "maxTrades": 7}, headers=a)
    assert client.delete("/api/entries", headers=a).status_code == 204
    assert client.get("/api/entries", headers=a).json() == []
    assert len(client.get("/api/entries", headers=b).json()) == 3
    assert client.get("/api/settings", headers=a).json()["maxTrades"] == 7


def test_many_entries_roundtrip(client, auth):
    for i in range(60):
        assert client.post("/api/entries", json=trade(timestamp=NOW + i), headers=auth).status_code == 201
    listed = client.get("/api/entries", headers=auth).json()
    assert len(listed) == 60 and len({e["id"] for e in listed}) == 60


def test_cors_preflight_for_the_frontend_origin(client):
    r = client.options("/api/entries", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "http://localhost:5173"
    bad = client.options("/api/entries", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_sql_injection_strings_are_stored_literally(client, auth):
    evil = "'); DROP TABLE entries; --"
    e = client.post("/api/entries", json=trade(pair="X'--", notes=evil), headers=auth).json()
    assert client.get("/api/entries", headers=auth).json()[0]["notes"] == evil
    r = client.post("/api/auth/login", json={"email": "a'OR'1'='1@x.co", "password": "password123"})
    assert r.status_code == 401
    assert e["pair"] == "X'--"


def test_concurrent_registration_of_same_email_one_wins(client):
    import concurrent.futures as cf

    def reg(_):
        return client.post("/api/auth/register", json={"email": "race@example.com", "password": "password123"}).status_code

    with cf.ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(reg, range(8)))
    assert codes.count(201) == 1 and set(codes) <= {201, 409}


def test_response_time_is_reasonable(client, auth):
    t = time.perf_counter()
    for i in range(20):
        client.post("/api/entries", json=trade(timestamp=NOW + i), headers=auth)
    client.get("/api/entries", headers=auth)
    assert time.perf_counter() - t < 10
