import os

# Safe defaults so the test suite is self-contained and doesn't require a
# real .env file (and never touches the real database or external services).
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")
os.environ.setdefault("SENTRY_DSN", "")  # tests must never report to the real Sentry project
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("CANARY_BYPASS_TOKEN", "")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def db_session():
    # By default tests run against fast in-memory SQLite. Setting
    # TEST_DATABASE_URL (as the "integration" CI job does, pointing at a real
    # Postgres service container) runs this exact same suite against Postgres
    # instead -- this is what already caught the SQLite/Postgres datetime
    # mismatch once, so it's worth keeping as a real integration signal.
    test_db_url = os.environ.get("TEST_DATABASE_URL")

    if test_db_url:
        engine = create_engine(test_db_url)
    else:
        engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    # The real frontend always sends this header (see api.js); tests that
    # specifically exercise the CSRF guard override it per-request instead
    # of using a client without the default.
    with TestClient(app, headers={"X-Requested-With": "nightcord"}) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def no_real_dns(monkeypatch):
    """Domain-validation tests in test_auth.py cover the real MX-lookup logic
    directly. Every other test just needs *.edu addresses like
    'university.edu' to pass without making a real DNS call, since those
    aren't real institutions in our vendored dataset.
    """
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: True)


@pytest.fixture(autouse=True)
def no_real_breach_check(monkeypatch):
    """Breach-check tests in test_auth.py cover is_breached_password's real
    HTTP/hashing logic directly. Every other test just needs signup to work
    without making a real call to the Have I Been Pwned API. Patched on the
    importing module (routers/auth.py bare-imports the function, which
    freezes the reference at import time -- patching app.auth.is_breached_password
    would not affect this call site).
    """
    monkeypatch.setattr("app.routers.auth.is_breached_password", lambda password: False)


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """The rate limiter's storage is shared process memory (not per-request),
    so without resetting it, tests that repeatedly hit /auth/login or
    /auth/signup across the suite would eventually trip the real limits.
    """
    from app.rate_limit import limiter

    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture(autouse=True)
def always_night(monkeypatch):
    """Night-gate tests in test_gate.py cover the real is_night_in_timezone
    logic directly. Every other test just needs room/chat access to work
    regardless of the real time when the suite happens to run -- otherwise
    tests using a fallback UTC timezone would flake depending on the hour.
    """
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz_name, now=None: True)
