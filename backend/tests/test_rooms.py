import json
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest


@pytest.fixture()
def logged_in_room_user(sign_in):
    sign_in("roomuser@university.edu", first_name="Room User")


def test_rooms_require_auth(client):
    assert client.get("/rooms").status_code == 401
    assert client.post("/rooms", json={"name": "no-auth-room"}).status_code == 401


def test_create_and_list_rooms(client, logged_in_room_user):
    create_res = client.post("/rooms", json={"name": "late-night-calc"})
    assert create_res.status_code == 201
    assert create_res.json()["name"] == "late-night-calc"

    list_res = client.get("/rooms")
    assert list_res.status_code == 200
    names = [r["name"] for r in list_res.json()]
    assert "late-night-calc" in names


def test_create_room_rejects_duplicate_name(client, logged_in_room_user):
    client.post("/rooms", json={"name": "dup-room"})
    res = client.post("/rooms", json={"name": "dup-room"})
    assert res.status_code == 409


def test_room_messages_empty_initially(client, logged_in_room_user):
    room = client.post("/rooms", json={"name": "empty-room"}).json()
    res = client.get(f"/rooms/{room['id']}/messages")
    assert res.status_code == 200
    assert res.json() == []


def test_room_messages_404_for_missing_room(client, logged_in_room_user):
    res = client.get("/rooms/999999/messages")
    assert res.status_code == 404


# --- rate limits ---


def test_room_creation_is_limited_per_account(client, sign_in):
    sign_in("maker@university.edu")
    statuses = [client.post("/rooms", json={"name": f"room-{n}"}).status_code for n in range(11)]
    assert statuses[:10] == [201] * 10
    assert statuses[10] == 429
    assert client.post("/rooms", json={"name": "one-more"}).json()["detail"].startswith("Too many requests")

    # A different student on the same network (same IP here) has their own allowance.
    sign_in("other.maker@university.edu")
    assert client.post("/rooms", json={"name": "someone-elses-room"}).status_code == 201


# --- message history pages ---


def _seed_messages(db_session, room_id, count):
    from app.models import Message, User

    author = db_session.query(User).filter(User.email == "roomuser@university.edu").first()
    for n in range(count):
        db_session.add(Message(room_id=room_id, user_id=author.id, content=f"msg {n}"))
    db_session.commit()


def test_history_returns_the_latest_page_oldest_first(client, db_session, logged_in_room_user):
    room = client.post("/rooms", json={"name": "busy-room"}).json()
    _seed_messages(db_session, room["id"], 120)

    page = client.get(f"/rooms/{room['id']}/messages").json()

    assert len(page) == 50
    assert [m["content"] for m in page] == [f"msg {n}" for n in range(70, 120)]


def test_history_pages_backwards_with_before(client, db_session, logged_in_room_user):
    room = client.post("/rooms", json={"name": "paging-room"}).json()
    _seed_messages(db_session, room["id"], 120)

    contents = []
    before = None
    while True:
        params = {"before": before} if before else {}
        page = client.get(f"/rooms/{room['id']}/messages", params=params).json()
        contents = [m["content"] for m in page] + contents
        if len(page) < 50:
            break
        before = page[0]["id"]

    assert contents == [f"msg {n}" for n in range(120)]


def test_history_page_size_is_capped(client, logged_in_room_user):
    room = client.post("/rooms", json={"name": "cap-room"}).json()
    assert client.get(f"/rooms/{room['id']}/messages", params={"limit": 100}).status_code == 200
    assert client.get(f"/rooms/{room['id']}/messages", params={"limit": 101}).status_code == 422


# --- video join tokens ---

TEST_LIVEKIT_SECRET = "test-livekit-secret-that-is-long-enough"


@pytest.fixture()
def livekit_configured(monkeypatch):
    monkeypatch.setattr("app.routers.rooms.settings.livekit_url", "wss://test.livekit.cloud")
    monkeypatch.setattr("app.routers.rooms.settings.livekit_api_key", "test-key")
    monkeypatch.setattr("app.routers.rooms.settings.livekit_api_secret", TEST_LIVEKIT_SECRET)


def test_video_token_requires_sign_in(client, livekit_configured):
    assert client.post("/rooms/1/video-token").status_code == 401


def test_video_token_for_a_room(client, logged_in_room_user, livekit_configured):
    room = client.post("/rooms", json={"name": "video-room"}).json()

    res = client.post(f"/rooms/{room['id']}/video-token")

    assert res.status_code == 200
    assert res.json()["url"] == "wss://test.livekit.cloud"
    claims = jwt.decode(res.json()["token"], TEST_LIVEKIT_SECRET, algorithms=["HS256"])
    assert claims["name"] == "roomuser"
    assert claims["video"]["room"] == f"room-{room['id']}"
    assert claims["video"]["roomJoin"] is True
    assert claims["video"]["canPublishSources"] == ["camera", "microphone"]
    assert claims["video"]["canPublishData"] is False
    # Others in the call show this avatar while the camera is off (None: the pixel avatar).
    assert json.loads(claims["metadata"]) == {"avatar_url": None}
    # The always_night fixture puts 6am a day away; the token stops there.
    assert claims["exp"] <= time.time() + 24 * 3600 + 5


def test_video_token_stops_at_6am(client, logged_in_room_user, livekit_configured, monkeypatch):
    room = client.post("/rooms", json={"name": "video-morning"}).json()
    six_am = datetime.now(timezone.utc) + timedelta(minutes=10)
    monkeypatch.setattr("app.gate.night_ends_at", lambda tz_name, now=None: six_am)

    token = client.post(f"/rooms/{room['id']}/video-token").json()["token"]

    exp = jwt.decode(token, TEST_LIVEKIT_SECRET, algorithms=["HS256"])["exp"]
    assert abs(exp - six_am.timestamp()) < 5


def test_video_token_blocked_outside_night(client, logged_in_room_user, livekit_configured, monkeypatch):
    room = client.post("/rooms", json={"name": "video-daytime"}).json()
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)
    assert client.post(f"/rooms/{room['id']}/video-token").status_code == 403


def test_video_token_404_for_missing_room(client, logged_in_room_user, livekit_configured):
    assert client.post("/rooms/999999/video-token").status_code == 404


def test_video_token_503_when_video_isnt_set_up(client, logged_in_room_user, monkeypatch):
    room = client.post("/rooms", json={"name": "video-off"}).json()
    monkeypatch.setattr("app.routers.rooms.settings.livekit_api_secret", "")
    res = client.post(f"/rooms/{room['id']}/video-token")
    assert res.status_code == 503
    assert res.json()["detail"] == "Video isn't set up yet."
