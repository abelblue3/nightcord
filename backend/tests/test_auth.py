from datetime import datetime, timedelta, timezone

import pytest

from app.auth import generate_verification_token, hash_password, is_allowed_student_email, verify_password
from app.models import User


# --- pure helper functions ---


@pytest.mark.parametrize(
    "email,expected",
    [
        ("student@university.edu", True),
        ("student@college.EDU", True),
        ("student@notedu.com", False),
        ("student@edu.fake.com", False),
        ("student@gmail.com", False),
    ],
)
def test_is_allowed_student_email(email, expected):
    assert is_allowed_student_email(email) is expected


def test_hash_and_verify_password_roundtrip():
    hashed = hash_password("correct-horse-battery-staple")
    assert verify_password("correct-horse-battery-staple", hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_verify_password_handles_none_hash():
    # Google-only accounts have no password hash at all.
    assert verify_password("anything", None) is False


def test_generate_verification_token_shape():
    token, expires_at = generate_verification_token()
    assert isinstance(token, str) and len(token) > 20
    assert expires_at > datetime.now(timezone.utc)


# --- signup ---


def test_signup_success(client, sent_emails):
    res = client.post(
        "/auth/signup",
        json={"email": "new.student@university.edu", "password": "password123", "display_name": "New Student"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "new.student@university.edu"
    assert body["is_verified"] is False
    assert len(sent_emails) == 1
    assert sent_emails[0]["to"] == "new.student@university.edu"


def test_signup_rejects_non_edu_email(client):
    res = client.post(
        "/auth/signup",
        json={"email": "random@gmail.com", "password": "password123", "display_name": "Rando"},
    )
    assert res.status_code == 400


def test_signup_rejects_duplicate_email(client):
    payload = {"email": "dupe@university.edu", "password": "password123", "display_name": "Dupe"}
    assert client.post("/auth/signup", json=payload).status_code == 201
    res = client.post("/auth/signup", json=payload)
    assert res.status_code == 409


# --- login ---


def test_login_before_verification_is_rejected(client):
    client.post(
        "/auth/signup",
        json={"email": "unverified@university.edu", "password": "password123", "display_name": "Unverified"},
    )
    res = client.post("/auth/login", json={"email": "unverified@university.edu", "password": "password123"})
    assert res.status_code == 403
    assert "verify your email" in res.json()["detail"].lower()


def test_login_wrong_password(client, db_session):
    _signup_and_verify(client, db_session, "loginwrong@university.edu")
    res = client.post("/auth/login", json={"email": "loginwrong@university.edu", "password": "not-the-password"})
    assert res.status_code == 401


def test_login_nonexistent_user(client):
    res = client.post("/auth/login", json={"email": "nobody@university.edu", "password": "password123"})
    assert res.status_code == 401


def test_login_success_after_verification(client, db_session):
    _signup_and_verify(client, db_session, "verified@university.edu")
    res = client.post("/auth/login", json={"email": "verified@university.edu", "password": "password123"})
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"]
    assert body["user"]["is_verified"] is True


# --- verify-email ---


def test_verify_email_invalid_token(client):
    res = client.post("/auth/verify-email", json={"token": "not-a-real-token"})
    assert res.status_code == 400


def test_verify_email_token_cannot_be_reused(client, db_session):
    token = _signup_and_get_token(client, db_session, "reuse@university.edu")
    first = client.post("/auth/verify-email", json={"token": token})
    assert first.status_code == 200
    second = client.post("/auth/verify-email", json={"token": token})
    assert second.status_code == 400


def test_verify_email_expired_token(client, db_session):
    token = _signup_and_get_token(client, db_session, "expired@university.edu")
    user = db_session.query(User).filter(User.email == "expired@university.edu").first()
    user.verification_token_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.commit()

    res = client.post("/auth/verify-email", json={"token": token})
    assert res.status_code == 400
    assert "expired" in res.json()["detail"].lower()


# --- resend-verification ---


def test_resend_verification_sends_new_token_for_unverified_user(client, db_session, sent_emails):
    original_token = _signup_and_get_token(client, db_session, "resend@university.edu")
    sent_emails.clear()

    res = client.post("/auth/resend-verification", json={"email": "resend@university.edu"})
    assert res.status_code == 200
    assert len(sent_emails) == 1
    assert sent_emails[0]["token"] != original_token


def test_resend_verification_same_generic_message_for_unknown_email(client):
    res = client.post("/auth/resend-verification", json={"email": "ghost@university.edu"})
    assert res.status_code == 200
    assert "verifying" in res.json()["message"].lower()


def test_resend_verification_noop_for_already_verified_user(client, db_session, sent_emails):
    _signup_and_verify(client, db_session, "already@university.edu")
    sent_emails.clear()

    client.post("/auth/resend-verification", json={"email": "already@university.edu"})
    assert len(sent_emails) == 0


# --- google auth ---


def _fake_google_claims(email="student@university.edu", email_verified=True, sub="google-sub-123", name="G Student"):
    return {"email": email, "email_verified": email_verified, "sub": sub, "name": name}


def test_google_auth_creates_new_verified_user(client, monkeypatch):
    monkeypatch.setattr("app.routers.auth.verify_google_id_token", lambda credential: _fake_google_claims())

    res = client.post("/auth/google", json={"credential": "fake-credential"})
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["email"] == "student@university.edu"
    assert body["user"]["is_verified"] is True


def test_google_auth_rejects_unverified_google_email(client, monkeypatch):
    monkeypatch.setattr(
        "app.routers.auth.verify_google_id_token",
        lambda credential: _fake_google_claims(email_verified=False),
    )
    res = client.post("/auth/google", json={"credential": "fake-credential"})
    assert res.status_code == 400


def test_google_auth_rejects_non_edu_email(client, monkeypatch):
    monkeypatch.setattr(
        "app.routers.auth.verify_google_id_token",
        lambda credential: _fake_google_claims(email="student@gmail.com"),
    )
    res = client.post("/auth/google", json={"credential": "fake-credential"})
    assert res.status_code == 400


def test_google_auth_links_existing_password_account(client, db_session, monkeypatch):
    _signup_and_verify(client, db_session, "linkme@university.edu")

    monkeypatch.setattr(
        "app.routers.auth.verify_google_id_token",
        lambda credential: _fake_google_claims(email="linkme@university.edu"),
    )
    res = client.post("/auth/google", json={"credential": "fake-credential"})
    assert res.status_code == 200

    user = db_session.query(User).filter(User.email == "linkme@university.edu").first()
    assert user.google_id == "google-sub-123"


def test_password_login_rejected_for_google_only_account(client, monkeypatch):
    monkeypatch.setattr("app.routers.auth.verify_google_id_token", lambda credential: _fake_google_claims())
    client.post("/auth/google", json={"credential": "fake-credential"})

    res = client.post("/auth/login", json={"email": "student@university.edu", "password": "anything"})
    assert res.status_code == 401
    assert "google sign-in" in res.json()["detail"].lower()


# --- helpers ---


def _signup_and_get_token(client, db_session, email) -> str:
    client.post(
        "/auth/signup",
        json={"email": email, "password": "password123", "display_name": "Test User"},
    )
    user = db_session.query(User).filter(User.email == email).first()
    return user.verification_token


def _signup_and_verify(client, db_session, email) -> None:
    token = _signup_and_get_token(client, db_session, email)
    res = client.post("/auth/verify-email", json={"token": token})
    assert res.status_code == 200
