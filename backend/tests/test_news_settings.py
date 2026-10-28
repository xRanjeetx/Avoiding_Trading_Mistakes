from conftest import signup

NFP = 1_791_000_000_000  # an arbitrary moment, in epoch milliseconds


def put(client, h, **news):
    s = client.get("/api/settings", headers=h).json()
    s["news"] = news
    return client.put("/api/settings", json=s, headers=h)


def test_new_accounts_have_no_news_and_a_two_hour_lead(client):
    h = signup(client)
    assert client.get("/api/settings", headers=h).json()["news"] == {"leadMin": 120, "events": []}


def test_news_roundtrip_sorted_and_trimmed(client):
    h = signup(client)
    r = put(client, h, leadMin=90, events=[{"at": NFP + 5000, "title": "  FOMC  "}, {"at": NFP, "title": "NFP"}, {"at": NFP + 9000}])
    assert r.status_code == 200, r.text
    got = client.get("/api/settings", headers=h).json()["news"]
    assert got["leadMin"] == 90
    assert got["events"] == [{"at": NFP, "title": "NFP"}, {"at": NFP + 5000, "title": "FOMC"}, {"at": NFP + 9000, "title": ""}]
    s = client.get("/api/settings", headers=h).json()
    s["maxTrades"] = 6  # changing something else keeps the news
    assert len(client.put("/api/settings", json=s, headers=h).json()["news"]["events"]) == 3


def test_news_is_per_user(client):
    a, b = signup(client), signup(client, "bobby")
    put(client, a, events=[{"at": NFP, "title": "NFP"}])
    assert client.get("/api/settings", headers=b).json()["news"]["events"] == []


def test_bad_news_is_rejected_and_nothing_is_saved(client):
    h = signup(client)
    assert put(client, h, leadMin=0).status_code == 422
    assert put(client, h, leadMin=1441).status_code == 422
    assert put(client, h, events=[{"at": -1}]).status_code == 422
    assert put(client, h, events=[{"at": "tomorrow"}]).status_code == 422
    assert put(client, h, events=[{"at": NFP, "title": "x" * 61}]).status_code == 422
    assert put(client, h, events=[{"at": NFP + i} for i in range(201)]).status_code == 422
    assert client.get("/api/settings", headers=h).json()["news"] == {"leadMin": 120, "events": []}
