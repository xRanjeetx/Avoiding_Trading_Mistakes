from conftest import signup


def test_auth_flow(client):
    signup(client)
    assert client.post("/api/auth/register", json={"email": "Alice@Example.com", "password": "password123"}).status_code == 409
    assert client.post("/api/auth/register", json={"email": "not-an-email", "password": "password123"}).status_code == 422
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrongpass1"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "alice@example.com", "password": "password123"}).status_code == 200
    assert client.get("/api/entries").status_code == 401


def test_settings_roundtrip(client):
    h = signup(client)
    s = client.get("/api/settings", headers=h).json()
    assert s["minRR"] == 2 and s["maxSL"] == 4 and s["lot"] == 0.02
    s["maxTrades"] = 5
    assert client.put("/api/settings", json=s, headers=h).json()["maxTrades"] == 5


def test_entry_crud_and_isolation(client):
    a, b = signup(client, "alice"), signup(client, "bobby")
    body = {"timestamp": 1_700_000_000_000, "pair": "XAUUSD", "dir": "buy", "lot": 0.02, "answers": {"1": True}, "failedRules": []}
    created = client.post("/api/entries", json=body, headers=a).json()
    assert created["answers"] == {"1": True} and created["result"] == "open"

    body.update(result="tp", pnl=24.5, closedAt=1_700_000_100_000)
    updated = client.put(f"/api/entries/{created['id']}", json=body, headers=a).json()
    assert updated["pnl"] == 24.5 and updated["closedAt"] == 1_700_000_100_000

    assert client.get("/api/entries", headers=b).json() == []
    assert client.delete(f"/api/entries/{created['id']}", headers=b).status_code == 404
    assert len(client.get("/api/entries", headers=a).json()) == 1
    assert client.delete(f"/api/entries/{created['id']}", headers=a).status_code == 204


def test_clear_all(client):
    h = signup(client)
    for ts in (1, 2):
        client.post("/api/entries", json={"timestamp": ts, "pair": "EURUSD"}, headers=h)
    assert len(client.get("/api/entries", headers=h).json()) == 2
    client.delete("/api/entries", headers=h)
    assert client.get("/api/entries", headers=h).json() == []
