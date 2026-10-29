from conftest import signup

SINCE = 1_791_000_000_000


def put(client, h, **patch):
    s = client.get("/api/settings", headers=h).json()
    return client.put("/api/settings", json={**s, **patch}, headers=h)


def test_new_accounts_have_no_loss_limits(client):
    h = signup(client)
    assert client.get("/api/settings", headers=h).json()["lossLimits"] == {"daily": None, "overall": None, "since": None}


def test_loss_limits_roundtrip_and_survive_other_changes(client):
    h = signup(client)
    r = put(client, h, lossLimits={"daily": 20, "overall": 1000.5, "since": SINCE})
    assert r.status_code == 200, r.text
    assert r.json()["lossLimits"] == {"daily": 20, "overall": 1000.5, "since": SINCE}
    assert put(client, h, maxTrades=6).json()["lossLimits"]["overall"] == 1000.5


def test_a_limit_can_be_switched_off_with_null(client):
    h = signup(client)
    put(client, h, lossLimits={"daily": 20, "overall": 100})
    got = put(client, h, lossLimits={"daily": None, "overall": 100}).json()["lossLimits"]
    assert got["daily"] is None and got["overall"] == 100


def test_bad_limits_are_rejected(client):
    h = signup(client)
    for bad in ({"daily": 0}, {"daily": -5}, {"overall": -1}, {"since": -1}, {"daily": "abc"}):
        assert put(client, h, lossLimits=bad).status_code == 422, bad


def test_pair_value_roundtrip_and_validation(client):
    h = signup(client)
    pairs = [{"pair": "XAUUSD", "lot": 0.02, "value": 100}, {"pair": "US30", "lot": 0.1}]
    got = put(client, h, pairs=pairs).json()["pairs"]
    assert got[0]["value"] == 100 and got[1]["value"] is None
    for bad in (0, -1):
        assert put(client, h, pairs=[{"pair": "US30", "lot": 0.1, "value": bad}]).status_code == 422
