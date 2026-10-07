from datetime import datetime, timezone as dt_timezone

import pytest
from starlette.websockets import WebSocketDisconnect

from app.gate import (
    FALLBACK_TIMEZONE,
    canary_bypass_active,
    dev_bypass_active,
    is_night_in_timezone,
    is_valid_timezone,
    resolve_signup_timezone,
)
from app.campus_time import NOT_FOUND, SchoolLookup
from app.models import User


# --- is_valid_timezone ---


def test_is_valid_timezone_accepts_real_iana_names():
    assert is_valid_timezone("America/New_York") is True
    assert is_valid_timezone("UTC") is True


def test_is_valid_timezone_rejects_garbage():
    assert is_valid_timezone("Not/A/Real/Zone") is False
    assert is_valid_timezone("") is False


# --- is_night_in_timezone ---


@pytest.mark.parametrize(
    "hour,expected",
    [(21, True), (23, True), (0, True), (5, True), (6, False), (12, False), (20, False)],
)
def test_is_night_in_timezone_hour_boundaries(hour, expected):
    now = datetime(2026, 1, 1, hour, 0, tzinfo=dt_timezone.utc)
    assert is_night_in_timezone("UTC", now=now) is expected


def test_is_night_in_timezone_converts_across_zones():
    # At this instant: LA local time is 3am (night), NY local time is exactly
    # 6am (day) -- a real cross-zone case, not just re-testing UTC math.
    now = datetime(2026, 1, 2, 11, 0, tzinfo=dt_timezone.utc)
    assert is_night_in_timezone("America/Los_Angeles", now=now) is True
    assert is_night_in_timezone("America/New_York", now=now) is False


def test_is_night_in_timezone_falls_back_to_utc_for_invalid_zone():
    now = datetime(2026, 1, 1, 22, 0, tzinfo=dt_timezone.utc)  # 10pm UTC -> night
    assert is_night_in_timezone("not-a-real-zone", now=now) is True


# --- resolve_signup_timezone ---


def test_resolve_signup_timezone_uses_institution_when_known():
    # Institution wins even though the client claims a different zone.
    school = SchoolLookup(found=True, timezone="America/New_York")
    assert resolve_signup_timezone(school, "America/Los_Angeles") == "America/New_York"


def test_resolve_signup_timezone_falls_back_to_client_when_school_unknown():
    assert resolve_signup_timezone(NOT_FOUND, "America/Denver") == "America/Denver"


def test_resolve_signup_timezone_falls_back_to_client_when_school_has_no_timezone():
    school = SchoolLookup(found=True, timezone=None)  # e.g. held back by campus-time, or a multi-zone chain
    assert resolve_signup_timezone(school, "America/Denver") == "America/Denver"


def test_resolve_signup_timezone_ignores_an_invalid_school_timezone():
    school = SchoolLookup(found=True, timezone="Not/A/Zone")
    assert resolve_signup_timezone(school, "America/Denver") == "America/Denver"


def test_resolve_signup_timezone_falls_back_to_utc_when_nothing_valid():
    assert resolve_signup_timezone(NOT_FOUND, None) == FALLBACK_TIMEZONE
    assert resolve_signup_timezone(NOT_FOUND, "not-a-real-zone") == FALLBACK_TIMEZONE


# --- dev / canary bypass ---


def test_dev_bypass_active_in_development(monkeypatch):
    monkeypatch.setattr("app.gate.settings.environment", "development")
    assert dev_bypass_active("1") is True
    assert dev_bypass_active("0") is False
    assert dev_bypass_active(None) is False


def test_dev_bypass_never_active_in_production(monkeypatch):
    monkeypatch.setattr("app.gate.settings.environment", "production")
    assert dev_bypass_active("1") is False


def test_dev_bypass_never_active_in_any_other_deployed_environment(monkeypatch):
    # Opt-in ("== development"), not opt-out ("!= production") -- a real
    # deployed environment we haven't explicitly named yet (beta, staging,
    # ...) must default to secure, not accidentally inherit the bypass.
    monkeypatch.setattr("app.gate.settings.environment", "beta")
    assert dev_bypass_active("1") is False


def test_canary_bypass_requires_matching_nonempty_token(monkeypatch):
    monkeypatch.setattr("app.gate.settings.canary_bypass_token", "secret123")
    assert canary_bypass_active("secret123") is True
    assert canary_bypass_active("wrong") is False
    assert canary_bypass_active(None) is False


def test_canary_bypass_inactive_when_not_configured(monkeypatch):
    monkeypatch.setattr("app.gate.settings.canary_bypass_token", "")
    assert canary_bypass_active("") is False
    assert canary_bypass_active(None) is False


# --- first sign-in stores the resolved timezone ---


def test_first_sign_in_stores_institution_timezone(client, db_session, sign_in):
    sign_in("student@harvard.edu")
    user = db_session.query(User).filter(User.email == "student@harvard.edu").first()
    assert user.timezone == "America/New_York"


def test_first_sign_in_stores_client_fallback_timezone_for_unknown_school(client, db_session, sign_in):
    sign_in("student@totally-unknown-school.edu", timezone="America/Denver")
    user = db_session.query(User).filter(User.email == "student@totally-unknown-school.edu").first()
    assert user.timezone == "America/Denver"


# --- server-side enforcement on rooms/chat ---


@pytest.fixture()
def logged_in_gate_user(sign_in):
    # university.edu isn't a known school and no browser timezone is sent,
    # so this account falls back to UTC.
    sign_in("gateuser@university.edu")


def test_rooms_accessible_when_night(client, logged_in_gate_user):
    # the autouse always_night fixture makes this the default state
    res = client.get("/rooms")
    assert res.status_code == 200


def test_rooms_blocked_when_closed(client, logged_in_gate_user, monkeypatch):
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    res = client.get("/rooms")
    assert res.status_code == 403
    assert "timezone" in res.json()["detail"]


def test_rooms_dev_bypass_header_overrides_closed_gate(client, logged_in_gate_user, monkeypatch):
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    monkeypatch.setattr("app.gate.settings.environment", "development")
    res = client.get("/rooms", headers={"X-Dev-Skip-Gate": "1"})
    assert res.status_code == 200


def test_rooms_dev_bypass_never_works_in_production(client, logged_in_gate_user, monkeypatch):
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    monkeypatch.setattr("app.gate.settings.environment", "production")
    res = client.get("/rooms", headers={"X-Dev-Skip-Gate": "1"})
    assert res.status_code == 403


def test_rooms_dev_bypass_never_works_on_beta(client, logged_in_gate_user, monkeypatch):
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    monkeypatch.setattr("app.gate.settings.environment", "beta")
    res = client.get("/rooms", headers={"X-Dev-Skip-Gate": "1"})
    assert res.status_code == 403


def test_rooms_canary_bypass_overrides_closed_gate(client, logged_in_gate_user, monkeypatch):
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    monkeypatch.setattr("app.gate.settings.canary_bypass_token", "canary-secret")
    res = client.get("/rooms", headers={"X-Canary-Token": "canary-secret"})
    assert res.status_code == 200


def test_create_room_and_messages_also_gated(client, logged_in_gate_user, monkeypatch):
    room = client.post("/rooms", json={"name": "should-not-matter"}).json()

    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)

    assert client.post("/rooms", json={"name": "closed-attempt"}).status_code == 403
    assert client.get(f"/rooms/{room['id']}/messages").status_code == 403


def test_websocket_rejects_when_gate_closed(client, logged_in_gate_user, room_socket, monkeypatch):
    room = client.post("/rooms", json={"name": "gate-ws-closed-room"}).json()

    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)

    with room_socket(room["id"]) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    # The reason carries the timezone, so the browser can show the countdown.
    assert closed.value.reason == "gate-closed:UTC"


def test_websocket_dev_bypass_allows_connection_when_closed(client, logged_in_gate_user, room_socket, monkeypatch):
    room = client.post("/rooms", json={"name": "gate-ws-bypass-room"}).json()

    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    monkeypatch.setattr("app.gate.settings.environment", "development")

    with room_socket(room["id"], query="?skip_gate=1") as ws:
        ws.send_json({"content": "hello despite closed gate"})
        received = ws.receive_json()
    assert received["content"] == "hello despite closed gate"


def test_websocket_canary_bypass_uses_a_header(client, logged_in_gate_user, room_socket, monkeypatch):
    room = client.post("/rooms", json={"name": "gate-ws-canary-room"}).json()

    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    monkeypatch.setattr("app.gate.settings.canary_bypass_token", "canary-secret")

    with room_socket(room["id"], headers={"X-Canary-Token": "canary-secret"}) as ws:
        ws.send_json({"content": "canary ping"})
        assert ws.receive_json()["content"] == "canary ping"

    # The old query-string form no longer works -- tokens in URLs end up in logs.
    with room_socket(room["id"], query="?canary_token=canary-secret") as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.reason.startswith("gate-closed:")


def test_canary_bypass_rejects_a_near_miss(monkeypatch):
    monkeypatch.setattr("app.gate.settings.canary_bypass_token", "canary-secret")
    assert canary_bypass_active("canary-secreT") is False
    assert canary_bypass_active("canary-secret-and-more") is False
