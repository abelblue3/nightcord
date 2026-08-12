from datetime import datetime, timedelta, timezone

import httpx
import pytest

import dns.resolver

from app.auth import (
    has_valid_mx_record,
    hash_password,
    is_allowed_student_email,
    is_breached_password,
    pwd_context,
    verify_password,
)
from app.config import settings
from app.edu_domains import is_known_edu_institution
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


# --- real institution dataset ---


@pytest.mark.parametrize(
    "domain,expected",
    [
        ("harvard.edu", True),
        ("stanford.edu", True),
        ("HARVARD.EDU", True),
        ("cs.harvard.edu", True),  # subdomain of a known institution
        ("grad.cs.harvard.edu", True),  # multi-level subdomain
        ("not-a-real-school.edu", False),
        ("harvard.edu.fake.com", False),  # known domain as a suffix, not the actual domain
    ],
)
def test_is_known_edu_institution(domain, expected):
    assert is_known_edu_institution(domain) is expected


# --- MX record check ---


def test_has_valid_mx_record_true_when_answers_exist(monkeypatch):
    monkeypatch.setattr("app.auth.dns.resolver.resolve", lambda domain, rtype, lifetime: ["mx1.example.com"])
    assert has_valid_mx_record("example.edu") is True


@pytest.mark.parametrize(
    "exception",
    [
        dns.resolver.NXDOMAIN(),
        dns.resolver.NoAnswer(),
        dns.resolver.NoNameservers(),
        dns.exception.Timeout(),
    ],
)
def test_has_valid_mx_record_false_on_dns_failures(monkeypatch, exception):
    def raise_it(domain, rtype, lifetime):
        raise exception

    monkeypatch.setattr("app.auth.dns.resolver.resolve", raise_it)
    assert has_valid_mx_record("nonexistent.edu") is False


def test_has_valid_mx_record_fails_closed_on_unexpected_error(monkeypatch):
    def raise_it(domain, rtype, lifetime):
        raise RuntimeError("something the DNS library didn't expect")

    monkeypatch.setattr("app.auth.dns.resolver.resolve", raise_it)
    assert has_valid_mx_record("example.edu") is False


# --- breached-password (Have I Been Pwned) check ---


def test_is_breached_password_true_when_suffix_matches(monkeypatch):
    # SHA-1("hunter2") = F3BBBD66A63D4BF1747940578EC3D0103530E21D
    # prefix "F3BBB", real suffix "D66A63D4BF1747940578EC3D0103530E21D"
    def fake_get(url, timeout):
        assert url.endswith("/range/F3BBB")
        body = "D66A63D4BF1747940578EC3D0103530E21D:37\nAAAA111111111111111111111111111111:1"
        return httpx.Response(200, text=body, request=httpx.Request("GET", url))

    monkeypatch.setattr("app.auth.httpx.get", fake_get)
    assert is_breached_password("hunter2") is True


def test_is_breached_password_false_when_no_suffix_matches(monkeypatch):
    def fake_get(url, timeout):
        body = "AAAA111111111111111111111111111111:1"
        return httpx.Response(200, text=body, request=httpx.Request("GET", url))

    monkeypatch.setattr("app.auth.httpx.get", fake_get)
    assert is_breached_password("hunter2") is False


def test_is_breached_password_fails_open_on_network_error(monkeypatch):
    def raise_it(url, timeout):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr("app.auth.httpx.get", raise_it)
    assert is_breached_password("anything") is False


def test_is_breached_password_fails_open_on_http_error_status(monkeypatch):
    def fake_get(url, timeout):
        return httpx.Response(500, request=httpx.Request("GET", url))

    monkeypatch.setattr("app.auth.httpx.get", fake_get)
    assert is_breached_password("anything") is False


# --- combined signup domain validation ---


def test_is_allowed_student_email_known_institution_skips_mx_lookup(monkeypatch):
    def fail_if_called(domain):
        raise AssertionError("should not need a DNS lookup for a known institution")

    monkeypatch.setattr("app.auth.has_valid_mx_record", fail_if_called)
    assert is_allowed_student_email("student@harvard.edu") is True


def test_is_allowed_student_email_unknown_domain_accepted_with_valid_mx(monkeypatch):
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: True)
    assert is_allowed_student_email("student@some-small-college.edu") is True


def test_is_allowed_student_email_unknown_domain_rejected_without_valid_mx(monkeypatch):
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: False)
    assert is_allowed_student_email("student@typo-domain.edu") is False


def test_is_allowed_student_email_wrong_suffix_never_reaches_mx_check(monkeypatch):
    def fail_if_called(domain):
        raise AssertionError("should not check MX for a domain that already fails the suffix check")

    monkeypatch.setattr("app.auth.has_valid_mx_record", fail_if_called)
    assert is_allowed_student_email("student@gmail.com") is False


def test_hash_and_verify_password_roundtrip():
    hashed = hash_password("correct-horse-battery-staple")
    assert verify_password("correct-horse-battery-staple", hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_verify_password_handles_none_hash():
    # Google-only accounts have no password hash at all.
    assert verify_password("anything", None) is False


# --- signup ---


def test_signup_success(client):
    res = client.post(
        "/auth/signup",
        json={"email": "new.student@university.edu", "password": "password123", "display_name": "New Student"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "new.student@university.edu"
    # Signup authenticates immediately -- there's no separate verification
    # step to complete before the account is usable.
    assert "access_token" in res.cookies


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


def test_signup_rejects_breached_password(client, monkeypatch):
    monkeypatch.setattr("app.routers.auth.is_breached_password", lambda password: True)
    res = client.post(
        "/auth/signup",
        json={"email": "breached@university.edu", "password": "whatever-it-is", "display_name": "Breached"},
    )
    assert res.status_code == 400
    assert "data breach" in res.json()["detail"].lower()


def test_signup_allows_clean_password(client, monkeypatch):
    # The no_real_breach_check autouse fixture already does this, but this
    # test makes the intent explicit and independent of that fixture's
    # continued existence.
    monkeypatch.setattr("app.routers.auth.is_breached_password", lambda password: False)
    res = client.post(
        "/auth/signup",
        json={"email": "clean@university.edu", "password": "not-in-any-breach", "display_name": "Clean"},
    )
    assert res.status_code == 201


# --- login ---


def test_login_wrong_password(client):
    _signup(client, "loginwrong@university.edu")
    res = client.post("/auth/login", json={"email": "loginwrong@university.edu", "password": "not-the-password"})
    assert res.status_code == 401


def test_login_nonexistent_user(client):
    res = client.post("/auth/login", json={"email": "nobody@university.edu", "password": "password123"})
    assert res.status_code == 401


def test_login_success(client):
    _signup(client, "loginok@university.edu")
    res = client.post("/auth/login", json={"email": "loginok@university.edu", "password": "password123"})
    assert res.status_code == 200
    assert "access_token" in res.cookies


# --- google auth ---


def _fake_google_claims(email="student@university.edu", email_verified=True, sub="google-sub-123", name="G Student"):
    return {"email": email, "email_verified": email_verified, "sub": sub, "name": name}


def test_google_auth_creates_new_user(client, monkeypatch):
    monkeypatch.setattr("app.routers.auth.verify_google_id_token", lambda credential: _fake_google_claims())

    res = client.post("/auth/google", json={"credential": "fake-credential"})
    assert res.status_code == 200
    assert "access_token" in res.cookies
    assert res.json()["email"] == "student@university.edu"


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
    _signup(client, "linkme@university.edu")

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
    # Deliberately the same generic message as any other failure -- a distinct
    # "use Google Sign-In" message would tell an attacker this email is registered.
    assert res.status_code == 401
    assert res.json()["detail"] == "Incorrect email or password."


# --- login: account lockout ---


def test_lockout_after_max_failed_attempts(client, db_session):
    _signup(client, "lockout@university.edu")

    for _ in range(settings.login_max_failed_attempts):
        res = client.post("/auth/login", json={"email": "lockout@university.edu", "password": "wrong"})
        assert res.status_code == 401

    # Locked now -- even the correct password is rejected, with the same generic message.
    res = client.post("/auth/login", json={"email": "lockout@university.edu", "password": "password123"})
    assert res.status_code == 401
    assert res.json()["detail"] == "Incorrect email or password."

    user = db_session.query(User).filter(User.email == "lockout@university.edu").first()
    assert user.lockout_until is not None


def test_lockout_clears_after_window_expires(client, db_session):
    _signup(client, "lockout2@university.edu")
    for _ in range(settings.login_max_failed_attempts):
        client.post("/auth/login", json={"email": "lockout2@university.edu", "password": "wrong"})

    user = db_session.query(User).filter(User.email == "lockout2@university.edu").first()
    assert user.lockout_until is not None
    user.lockout_until = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    res = client.post("/auth/login", json={"email": "lockout2@university.edu", "password": "password123"})
    assert res.status_code == 200


def test_successful_login_resets_failed_attempt_counter(client, db_session):
    _signup(client, "resetcount@university.edu")
    client.post("/auth/login", json={"email": "resetcount@university.edu", "password": "wrong"})
    client.post("/auth/login", json={"email": "resetcount@university.edu", "password": "wrong"})

    res = client.post("/auth/login", json={"email": "resetcount@university.edu", "password": "password123"})
    assert res.status_code == 200

    user = db_session.query(User).filter(User.email == "resetcount@university.edu").first()
    assert user.failed_login_attempts == 0
    assert user.lockout_until is None


# --- login: timing-safe against enumeration ---


def test_login_pays_the_same_bcrypt_cost_on_every_failure_path(client, monkeypatch):
    """Every branch that doesn't have a real password to check (no such user,
    a Google-only account, a locked account) must still call into
    pwd_context.verify -- otherwise response timing would reveal which case
    it is, even though the response body doesn't.
    """
    calls = []
    original_verify = pwd_context.verify

    def spy_verify(plain, hashed):
        calls.append(hashed)
        return original_verify(plain, hashed)

    monkeypatch.setattr("app.auth.pwd_context.verify", spy_verify)

    client.post("/auth/login", json={"email": "nobody-at-all@university.edu", "password": "x"})
    assert len(calls) == 1

    _signup(client, "realwrong@university.edu")
    client.post("/auth/login", json={"email": "realwrong@university.edu", "password": "wrong"})
    assert len(calls) == 2


# --- session cookie: logout and revocation ---


def test_logout_clears_the_cookie(client):
    _signup(client, "logoutme@university.edu")
    assert "access_token" in client.cookies

    res = client.post("/auth/logout")
    assert res.status_code == 200
    assert "access_token" not in client.cookies


def test_logout_all_invalidates_the_token_everywhere(client):
    _signup(client, "revokeme@university.edu")
    old_token = client.cookies["access_token"]

    res = client.post("/auth/logout-all")
    assert res.status_code == 200

    # A copy of the pre-revocation token, as if it were cached in another
    # browser, must be rejected too -- proving the token itself is dead, not
    # just that this client's local cookie got cleared.
    res = client.get("/rooms", cookies={"access_token": old_token})
    assert res.status_code == 401


def test_logout_all_requires_csrf_header(client):
    _signup(client, "csrfcheck@university.edu")

    res = client.post("/auth/logout-all", headers={"X-Requested-With": "not-nightcord"})
    assert res.status_code == 403


# --- helpers ---


def _signup(client, email, password="password123") -> None:
    res = client.post(
        "/auth/signup",
        json={"email": email, "password": password, "display_name": "Test User"},
    )
    assert res.status_code == 201
