def test_security_headers_present_on_every_response(client):
    res = client.get("/health")
    assert res.headers["content-security-policy"] == "default-src 'none'"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "no-referrer"


def test_hsts_absent_outside_production(client):
    res = client.get("/health")
    assert "strict-transport-security" not in res.headers


def test_hsts_present_in_production(client, monkeypatch):
    monkeypatch.setattr("app.main.settings.environment", "production")
    res = client.get("/health")
    assert res.headers["strict-transport-security"] == "max-age=63072000; includeSubDomains"


def test_hsts_present_on_beta_too(client, monkeypatch):
    # Any real deployed environment gets the secure defaults, not just the
    # one literally named "production" -- see app/main.py's comment.
    monkeypatch.setattr("app.main.settings.environment", "beta")
    res = client.get("/health")
    assert res.headers["strict-transport-security"] == "max-age=63072000; includeSubDomains"


def test_security_headers_present_on_error_responses_too(client):
    res = client.get("/rooms")
    assert res.status_code == 401
    assert res.headers["x-content-type-options"] == "nosniff"


# --- API docs ---


def test_api_docs_are_off_in_every_deployed_environment():
    from app.main import api_docs_settings

    for environment in ("production", "beta"):
        assert api_docs_settings(environment) == {"docs_url": None, "redoc_url": None, "openapi_url": None}


def test_api_docs_are_available_for_local_development(client):
    # The test suite runs with ENVIRONMENT=development (see conftest.py).
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200


def test_environment_defaults_to_production(monkeypatch):
    from app.config import Settings

    monkeypatch.delenv("ENVIRONMENT", raising=False)
    assert Settings(_env_file=None).environment == "production"
