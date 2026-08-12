import os

# Safe defaults so the test suite is self-contained and doesn't require a
# real .env file (and never touches the real database or external services).
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("RESEND_API_KEY", "test-resend-key")
os.environ.setdefault("EMAIL_FROM", "nightcord <test@example.com>")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-google-client-id")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app


@pytest.fixture()
def db_session():
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


@pytest.fixture()
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def sent_emails(monkeypatch):
    """Captures verification emails instead of hitting the real Resend API."""
    captured = []

    def fake_send(to_email, token):
        captured.append({"to": to_email, "token": token})

    monkeypatch.setattr("app.routers.auth.send_verification_email", fake_send)
    return captured


@pytest.fixture(autouse=True)
def no_real_dns(monkeypatch):
    """Domain-validation tests in test_auth.py cover the real MX-lookup logic
    directly. Every other test just needs *.edu addresses like
    'university.edu' to pass without making a real DNS call, since those
    aren't real institutions in our vendored dataset.
    """
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: True)
