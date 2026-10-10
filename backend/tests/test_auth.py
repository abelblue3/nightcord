import dns.resolver
import pytest

from app import clerk_auth
from app.auth import has_valid_mx_record, is_allowed_student_email
from app.campus_time import NOT_FOUND, SchoolLookup
from app.models import Message, Room, User
from tests.conftest import make_token

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
    assert is_allowed_student_email(email, NOT_FOUND) is expected

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


# --- combined signup domain validation ---


def test_is_allowed_student_email_known_institution_skips_mx_lookup(monkeypatch):
    def fail_if_called(domain):
        raise AssertionError("should not need a DNS lookup for a known institution")

    monkeypatch.setattr("app.auth.has_valid_mx_record", fail_if_called)
    assert is_allowed_student_email("student@harvard.edu", SchoolLookup(found=True, timezone=None)) is True


def test_is_allowed_student_email_unknown_domain_accepted_with_valid_mx(monkeypatch):
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: True)
    assert is_allowed_student_email("student@some-small-college.edu", NOT_FOUND) is True


def test_is_allowed_student_email_unknown_domain_rejected_without_valid_mx(monkeypatch):
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: False)
    assert is_allowed_student_email("student@typo-domain.edu", NOT_FOUND) is False


def test_is_allowed_student_email_wrong_suffix_never_reaches_mx_check(monkeypatch):
    def fail_if_called(domain):
        raise AssertionError("should not check MX for a domain that already fails the suffix check")

    monkeypatch.setattr("app.auth.has_valid_mx_record", fail_if_called)
    assert is_allowed_student_email("student@gmail.com", NOT_FOUND) is False


def test_is_allowed_student_email_known_school_on_a_non_edu_domain(monkeypatch):
    def fail_if_called(domain):
        raise AssertionError("a known school needs no DNS lookup")

    monkeypatch.setattr("app.auth.has_valid_mx_record", fail_if_called)
    # Some real colleges use .org/.com; being in the NCES school list is what counts.
    assert is_allowed_student_email("student@afi.com", SchoolLookup(found=True, timezone=None)) is True


def test_is_allowed_student_email_unknown_non_edu_domain_rejected(monkeypatch):
    monkeypatch.setattr("app.auth.has_valid_mx_record", lambda domain: True)
    # Receiving mail isn't enough off .edu: anyone can register a .org.
    assert is_allowed_student_email("someone@random-club.org", NOT_FOUND) is False


# --- Clerk session tokens ---


def test_valid_token_is_accepted():
    claims = clerk_auth.verify_session_token(make_token("user_abc"))
    assert claims["sub"] == "user_abc"


@pytest.mark.parametrize(
    "token",
    [
        pytest.param(make_token("user_abc", expires_in=-60), id="expired"),
        pytest.param(make_token("user_abc", azp="https://evil.example"), id="issued-to-another-site"),
        pytest.param("not.a.jwt", id="garbage"),
    ],
)
def test_bad_tokens_are_rejected(token):
    with pytest.raises(clerk_auth.InvalidSessionToken):
        clerk_auth.verify_session_token(token)


def test_token_signed_by_another_key_is_rejected():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    other = rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    )
    with pytest.raises(clerk_auth.InvalidSessionToken):
        clerk_auth.verify_session_token(make_token("user_abc", key=other))


def test_hs256_token_is_rejected():
    # The classic JWT mix-up: an HS256 token "signed" using the *public* key as
    # the HMAC secret. Built by hand, since PyJWT refuses to create one.
    import base64
    import hashlib
    import hmac
    import json

    from tests.conftest import TEST_PUBLIC_KEY_PEM

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(json.dumps({"sub": "user_abc", "exp": 9999999999, "nbf": 0}).encode())
    signature = hmac.new(TEST_PUBLIC_KEY_PEM.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    forged = f"{header}.{payload}.{b64(signature)}"

    with pytest.raises(clerk_auth.InvalidSessionToken):
        clerk_auth.verify_session_token(forged)


def test_server_minted_tokens_without_azp_are_accepted():
    # Tokens created through Clerk's Backend API (the canary's) carry no origin.
    assert clerk_auth.verify_session_token(make_token("user_abc", azp=None))["sub"] == "user_abc"


def test_requests_without_a_token_are_401(client):
    assert client.get("/rooms").status_code == 401


# --- POST /auth/session: linking a Clerk sign-in to a nightcord account ---


def test_first_sign_in_creates_the_account(client, db_session, sign_in):
    result = sign_in("new.student@harvard.edu", first_name="New", timezone="America/Los_Angeles")

    assert result.response.status_code == 200
    body = result.response.json()
    assert body["email"] == "new.student@harvard.edu"
    # The username comes from the email, not the real name (anonymous by default).
    assert body["display_name"] == "new_student"
    # The school's timezone wins over what the browser claimed.
    assert body["timezone"] == "America/New_York"

    user = db_session.query(User).filter(User.email == "new.student@harvard.edu").first()
    assert user.clerk_user_id == result.clerk_user_id
    # Clerk's name is kept privately.
    assert user.name == "New"
    assert user.show_name is False


def test_signing_in_again_returns_the_same_account(client, db_session, sign_in):
    first = sign_in("again@university.edu")
    second = client.post("/auth/session", json={})

    assert second.status_code == 200
    assert second.json()["id"] == first.response.json()["id"]
    assert db_session.query(User).count() == 1


def test_an_account_from_before_clerk_is_linked_by_email(client, db_session, sign_in):
    old = User(email="Old.Timer@university.edu", display_name="Old Timer", timezone="America/Chicago")
    db_session.add(old)
    db_session.flush()
    room = Room(name="old-room", created_by=old.id)
    db_session.add(room)
    db_session.flush()
    db_session.add(Message(room_id=room.id, user_id=old.id, content="from before Clerk"))
    db_session.commit()

    result = sign_in("old.timer@university.edu")

    body = result.response.json()
    assert body["id"] == old.id
    assert body["display_name"] == "Old Timer"
    assert body["timezone"] == "America/Chicago"
    db_session.refresh(old)
    assert old.clerk_user_id == result.clerk_user_id
    assert db_session.query(Message).filter(Message.user_id == old.id).count() == 1


def test_non_student_email_is_rejected_and_removed_from_clerk(client, db_session, fake_clerk, sign_in):
    result = sign_in("someone@gmail.com")

    assert result.response.status_code == 403
    assert "school email" in result.response.json()["detail"]
    assert fake_clerk.deleted == [result.clerk_user_id]
    assert db_session.query(User).count() == 0


def test_student_at_a_known_non_edu_school_can_join(client, db_session, fake_clerk, sign_in):
    # afi.com is AFI Conservatory's domain in the NCES school directory.
    result = sign_in("student@afi.com", timezone="America/Los_Angeles")

    assert result.response.status_code == 200
    assert fake_clerk.deleted == []
    user = db_session.query(User).filter(User.email == "student@afi.com").first()
    assert user.clerk_user_id == result.clerk_user_id


def test_unverified_email_is_rejected(client, fake_clerk, sign_in):
    result = sign_in("unverified@university.edu", verified=False)
    assert result.response.status_code == 403
    assert fake_clerk.deleted == []


def test_usernames_are_valid_and_unique(client, sign_in):
    first = sign_in("a.very.long.email.address.indeed@university.edu")
    assert first.response.json()["display_name"] == "a_very_long_email_ad"  # 20 characters at most

    sign_in("Night.Owl@university.edu")
    second = sign_in("night_owl@other-school.edu")
    assert second.response.json()["display_name"] == "night_owl2"


@pytest.mark.parametrize(
    "text,expected",
    [("Abel.Milkrick", "abel_milkrick"), ("a", "a_owl"), ("", "owl"), ("__x__", "x_owl"), ("Ünï", "n_owl")],
)
def test_slugify_makes_a_valid_username(text, expected):
    from app.usernames import USERNAME_PATTERN, slugify

    assert slugify(text) == expected
    assert USERNAME_PATTERN.fullmatch(slugify(text))


def test_session_needs_a_valid_token(client):
    assert client.post("/auth/session", json={}).status_code == 401
    bad = client.post("/auth/session", json={}, headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401


def test_clerk_outage_is_a_502(client, fake_clerk, sign_in):
    fake_clerk.unavailable = True
    result = sign_in("outage@university.edu")
    assert result.response.status_code == 502


def test_session_is_rate_limited(client, sign_in):
    sign_in("busy@university.edu")
    statuses = [client.post("/auth/session", json={}).status_code for _ in range(10)]
    assert statuses[-1] == 429


def test_signed_in_with_clerk_but_not_linked_yet(client, fake_clerk):
    clerk_user_id = fake_clerk.add_user("pending@university.edu")
    res = client.get("/rooms", headers={"Authorization": f"Bearer {make_token(clerk_user_id)}"})

    assert res.status_code == 401
    assert res.json()["detail"]["code"] == "not-linked"


# --- log out of all devices ---


def test_logout_all_revokes_every_clerk_session(client, fake_clerk, sign_in):
    result = sign_in("everywhere@university.edu")

    res = client.post("/auth/logout-all")

    assert res.status_code == 200
    assert fake_clerk.revoked == [result.clerk_user_id]


def test_logout_all_needs_a_signed_in_user(client):
    assert client.post("/auth/logout-all").status_code == 401


def test_jwt_key_is_accepted_without_its_begin_end_lines(monkeypatch):
    # Copying only the key body from the dashboard is an easy mistake; the
    # app wraps it back into a PEM instead of rejecting every sign-in.
    from tests.conftest import TEST_PUBLIC_KEY_PEM

    body = "".join(line for line in TEST_PUBLIC_KEY_PEM.splitlines() if "-----" not in line)
    monkeypatch.setattr("app.clerk_auth.settings.clerk_jwt_key", body)

    assert clerk_auth.verify_session_token(make_token("user_abc"))["sub"] == "user_abc"


# --- POST /auth/check-email: the instant check while signing up ---


@pytest.mark.parametrize(
    "email,allowed",
    [
        ("student@harvard.edu", True),  # known school
        ("student@cs.stanford.edu", True),  # subdomain of a known school
        ("student@afi.com", True),  # known school on a non-.edu domain
        ("student@some-small-college.edu", True),  # unknown .edu that receives mail
        ("someone@gmail.com", False),
        ("someone@random-club.org", False),
    ],
)
def test_check_email(client, email, allowed):
    res = client.post("/auth/check-email", json={"email": email})

    assert res.status_code == 200
    body = res.json()
    assert body["allowed"] is allowed
    assert (body["message"] is None) is allowed


def test_check_email_never_calls_clerk_or_campus_time(client, fake_clerk, monkeypatch):
    def fail_if_called(school_id):
        raise AssertionError("the instant check must not call campus-time")

    monkeypatch.setattr("app.campus_time.fetch_location_timezone", fail_if_called)
    fake_clerk.unavailable = True  # any Clerk call would fail

    assert client.post("/auth/check-email", json={"email": "student@harvard.edu"}).json()["allowed"] is True


def test_check_email_rejects_malformed_addresses(client):
    assert client.post("/auth/check-email", json={"email": "not-an-email"}).status_code == 422


def test_check_email_is_rate_limited(client):
    statuses = [client.post("/auth/check-email", json={"email": "a@harvard.edu"}).status_code for _ in range(31)]
    assert statuses[-1] == 429
