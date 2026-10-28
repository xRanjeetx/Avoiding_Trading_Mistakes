from conftest import signup

BODY = {"timestamp": 1_700_000_000_000, "pair": "XAUUSD"}


def test_emotions_default_to_none_and_roundtrip(client):
    h = signup(client)
    made = client.post("/api/entries", json=BODY, headers=h).json()
    assert made["emotion"] is None and made["emotionAfter"] is None
    body = {**BODY, "emotion": "calm", "emotionAfter": "relieved", "result": "tp", "pnl": 10}
    updated = client.put(f"/api/entries/{made['id']}", json=body, headers=h).json()
    assert (updated["emotion"], updated["emotionAfter"]) == ("calm", "relieved")
    assert client.get("/api/entries", headers=h).json()[0]["emotion"] == "calm"


def test_emotion_can_be_cleared(client):
    h = signup(client)
    made = client.post("/api/entries", json={**BODY, "emotion": "fomo"}, headers=h).json()
    cleared = client.put(f"/api/entries/{made['id']}", json={**BODY, "emotion": None}, headers=h).json()
    assert cleared["emotion"] is None


def test_bad_emotion_values_are_rejected(client):
    h = signup(client)
    for bad in ("Calm", "calm down!", "", "x" * 21, "1fomo", "<b>"):
        assert client.post("/api/entries", json={**BODY, "emotion": bad}, headers=h).status_code == 422, bad
        assert client.post("/api/entries", json={**BODY, "emotionAfter": bad}, headers=h).status_code == 422, bad


def test_import_keeps_emotions(client):
    h = signup(client)
    rows = [{"id": "a1", **BODY, "emotion": "revenge", "emotionAfter": "regret"}]
    assert client.post("/api/entries/import", json=rows, headers=h).json()["imported"] == 1
    got = client.get("/api/entries", headers=h).json()[0]
    assert (got["emotion"], got["emotionAfter"]) == ("revenge", "regret")
