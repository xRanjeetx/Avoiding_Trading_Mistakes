import pytest

from app.core import config


def test_responses_carry_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "camera=()" in r.headers["permissions-policy"]


def test_auth_responses_are_not_cacheable(client):
    r = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "correct-horse-42"})
    assert r.status_code == 401
    assert r.headers["cache-control"] == "no-store"
    assert "cache-control" not in client.get("/api/health").headers


def test_cors_only_allows_listed_origin_and_headers(client):
    ok = client.options("/api/entries", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    other = client.options("/api/entries", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in other.headers
    odd = client.options("/api/entries", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-evil",
    })
    assert odd.status_code == 400


def _prod(monkeypatch, **overrides):
    values = {
        "SECRET_KEY": "x" * 48, "CORS_ORIGINS": ["https://app.example.com"],
        "DATABASE_URL": "postgresql+psycopg://u:p@host/db", "IS_PRODUCTION": True, "EMAIL_ENABLED": True, **overrides,
    }
    for name, value in values.items():
        monkeypatch.setattr(config, name, value)


def test_good_production_settings_pass(monkeypatch):
    _prod(monkeypatch)
    assert config.production_problems() == []
    config.check_production()


@pytest.mark.parametrize("overrides, fragment", [
    ({"SECRET_KEY": config.DEV_SECRET_KEY}, "SECRET_KEY"),
    ({"SECRET_KEY": "too-short"}, "SECRET_KEY"),
    ({"CORS_ORIGINS": ["*"]}, "CORS_ORIGINS"),
    ({"CORS_ORIGINS": ["http://localhost:5173"]}, "CORS_ORIGINS"),
    ({"CORS_ORIGINS": ["http://app.example.com"]}, "https"),
    ({"DATABASE_URL": "sqlite:///./dev.db"}, "DATABASE_URL"),
    ({"EMAIL_ENABLED": False}, "SMTP_HOST"),
])
def test_unsafe_production_settings_stop_startup(monkeypatch, overrides, fragment):
    _prod(monkeypatch, **overrides)
    with pytest.raises(RuntimeError, match=fragment):
        config.check_production()


def test_development_is_not_checked(monkeypatch):
    _prod(monkeypatch, IS_PRODUCTION=False, SECRET_KEY=config.DEV_SECRET_KEY)
    config.check_production()
