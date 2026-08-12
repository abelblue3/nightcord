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


def test_security_headers_present_on_error_responses_too(client):
    res = client.get("/rooms")
    assert res.status_code == 401
    assert res.headers["x-content-type-options"] == "nosniff"
