import os
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from itertools import count
from types import SimpleNamespace

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

# A throwaway RSA key standing in for the Clerk instance's signing key: tests
# sign their own session tokens with it and the app verifies them with the
# public half, exactly as it would Clerk's. Nothing ever calls Clerk.
_SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
TEST_PRIVATE_KEY_PEM = _SIGNING_KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
TEST_PUBLIC_KEY_PEM = _SIGNING_KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
).decode()
TEST_ORIGIN = "http://localhost:5173"

# Safe defaults so the test suite is self-contained and doesn't require a
# real .env file (and never touches the real database or external services).
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SENTRY_DSN", "")  # tests must never report to the real Sentry project
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("CANARY_BYPASS_TOKEN", "")
os.environ["CORS_ORIGINS"] = TEST_ORIGIN
os.environ["CLERK_JWT_KEY"] = TEST_PUBLIC_KEY_PEM
os.environ["CLERK_SECRET_KEY"] = "sk_test_not_a_real_key"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.clerk_auth import ClerkAPIError, ClerkUser
from app.database import Base, get_db, get_session_factory
from app.main import app


def make_token(sub, *, azp=TEST_ORIGIN, expires_in=60, key=TEST_PRIVATE_KEY_PEM, algorithm="RS256", **claims):
    """A session token shaped like Clerk's (sub, sid, azp, iat, nbf, exp)."""
    now = int(time.time())
    payload = {"sub": sub, "sid": f"sess_{sub}", "iat": now, "nbf": now, "exp": now + expires_in, **claims}
    if azp is not None:
        payload["azp"] = azp
    return jwt.encode(payload, key, algorithm=algorithm)


class FakeClerk:
    """In-memory stand-in for the Clerk Backend API calls in app/clerk_auth.py."""

    def __init__(self):
        self._ids = count(1)
        self.users: dict[str, ClerkUser] = {}
        self.deleted: list[str] = []
        self.revoked: list[str] = []
        self.unavailable = False

    def add_user(self, email, *, verified=True, first_name=None, last_name=None) -> str:
        user_id = f"user_test{next(self._ids)}"
        self.users[user_id] = ClerkUser(user_id, email, verified, first_name, last_name)
        return user_id

    def get_user(self, user_id):
        if self.unavailable or user_id not in self.users:
            raise ClerkAPIError(f"no such user {user_id}")
        return self.users[user_id]

    def delete_user(self, user_id):
        self.users.pop(user_id, None)
        self.deleted.append(user_id)

    def revoke_all_sessions(self, user_id):
        if self.unavailable:
            raise ClerkAPIError("down")
        self.revoked.append(user_id)


@pytest.fixture(autouse=True)
def fake_clerk(monkeypatch):
    fake = FakeClerk()
    monkeypatch.setattr("app.clerk_auth.get_user", fake.get_user)
    monkeypatch.setattr("app.clerk_auth.delete_user", fake.delete_user)
    monkeypatch.setattr("app.clerk_auth.revoke_all_sessions", fake.revoke_all_sessions)
    return fake


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
    # The chat socket's short per-step sessions are all the shared one here.
    app.dependency_overrides[get_session_factory] = lambda: contextmanager(override_get_db)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def sign_in(client, fake_clerk):
    """Signs a student in the way the frontend does: a Clerk user exists, the
    browser holds its session token, and POST /auth/session links it to a
    nightcord account. The token is then sent on every later request.
    """

    def _sign_in(email="student@university.edu", *, first_name=None, verified=True, timezone=None):
        clerk_user_id = fake_clerk.add_user(email, verified=verified, first_name=first_name)
        token = make_token(clerk_user_id)
        client.headers["Authorization"] = f"Bearer {token}"
        response = client.post("/auth/session", json={"timezone": timezone})
        return SimpleNamespace(clerk_user_id=clerk_user_id, token=token, response=response)

    return _sign_in


@pytest.fixture()
def room_socket(client):
    """Opens a room's chat socket and sends the auth frame first, like chat.js."""

    @contextmanager
    def _open(room_id, *, token=None, query="", headers=None):
        token = token or client.headers["Authorization"].split(" ", 1)[1]
        with client.websocket_connect(f"/ws/rooms/{room_id}{query}", headers=headers or {}) as ws:
            ws.send_json({"type": "auth", "token": token})
            yield ws

    return _open


@pytest.fixture(autouse=True)
def no_real_dns(monkeypatch):
    """Domain-validation tests in test_auth.py cover the real MX-lookup logic
    directly. Every other test just needs *.edu addresses like
    'university.edu' to pass without making a real DNS call, since those
    aren't real institutions in our vendored dataset.
    """
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: True)


# What the campus-time API returns for the two real schools tests sign up
# with; every other school is treated as one it has no timezone for.
FAKE_CAMPUS_TIMEZONES = {
    "166027": "America/New_York",  # harvard.edu
    "243744": "America/Los_Angeles",  # stanford.edu
}


@pytest.fixture(autouse=True)
def no_real_campus_time(monkeypatch):
    """test_campus_time.py covers fetch_location_timezone's real HTTP logic
    directly. Every other test gets fixed answers instead of calling the
    live campus-time API; the domain -> school step still uses the real
    bundled data, since that's local.
    """
    monkeypatch.setattr("app.campus_time.fetch_location_timezone", FAKE_CAMPUS_TIMEZONES.get)


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """The rate limiter's storage is shared process memory (not per-request),
    so without resetting it, tests that repeatedly sign in or create rooms
    across the suite would eventually trip the real limits.
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
    # ...and no open chat socket reaches its 6am close mid-test.
    tomorrow = datetime.now(timezone.utc) + timedelta(days=1)
    monkeypatch.setattr("app.gate.night_ends_at", lambda tz_name, now=None: tomorrow)
