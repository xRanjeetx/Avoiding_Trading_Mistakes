from conftest import signup


def put(client, h, **rules):
    s = client.get("/api/settings", headers=h).json()
    s["rules"] = rules
    return client.put("/api/settings", json=s, headers=h)


def test_new_accounts_start_with_every_rule_on_and_none_custom(client):
    h = signup(client)
    assert client.get("/api/settings", headers=h).json()["rules"] == {"disabled": [], "custom": [], "nextId": 1000}


def test_rules_roundtrip_and_survive_other_settings_changes(client):
    h = signup(client)
    rules = {
        "disabled": [7, 3, 7, 1000],
        "custom": [{"id": 1000, "title": "  Checked the news  ", "q": "Is there no red-folder news in the next 30 min?"}],
        "nextId": 1001,
    }
    r = put(client, h, **rules)
    assert r.status_code == 200, r.text
    got = client.get("/api/settings", headers=h).json()["rules"]
    assert got["disabled"] == [3, 7, 1000]  # sorted, no duplicates
    assert got["custom"] == [{"id": 1000, "title": "Checked the news", "q": "Is there no red-folder news in the next 30 min?"}]
    s = client.get("/api/settings", headers=h).json()
    s["maxTrades"] = 6
    assert client.put("/api/settings", json=s, headers=h).json()["rules"]["custom"][0]["id"] == 1000


def test_next_id_always_moves_past_existing_custom_rules(client):
    h = signup(client)
    r = put(client, h, custom=[{"id": 1005, "title": "A"}], nextId=1000)
    assert r.json()["rules"]["nextId"] == 1006


def test_rules_are_per_user(client):
    a, b = signup(client), signup(client, "bobby")
    put(client, a, disabled=[7])
    assert client.get("/api/settings", headers=b).json()["rules"]["disabled"] == []


def test_bad_rules_are_rejected(client):
    h = signup(client)
    ok = {"id": 1000, "title": "x"}
    assert put(client, h, custom=[ok, ok]).status_code == 422  # duplicate id
    assert put(client, h, custom=[{"id": 5, "title": "x"}]).status_code == 422  # id range is for built-ins
    assert put(client, h, custom=[{"id": 1000, "title": "   "}]).status_code == 422  # empty title
    assert put(client, h, custom=[{"id": 1000, "title": "x" * 61}]).status_code == 422
    assert put(client, h, custom=[{"id": 1000, "title": "x", "q": "y" * 201}]).status_code == 422
    assert put(client, h, custom=[{"id": 1000 + i, "title": "x"} for i in range(31)]).status_code == 422  # at most 30
    assert put(client, h, disabled=[0]).status_code == 422
    assert client.get("/api/settings", headers=h).json()["rules"]["custom"] == []  # nothing was saved
