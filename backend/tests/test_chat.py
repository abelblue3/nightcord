import pytest
from starlette.websockets import WebSocketDisconnect

from app.models import User


@pytest.fixture()
def logged_in_user(client, db_session):
    client.post(
        "/auth/signup",
        json={"email": "chatuser@university.edu", "password": "password123", "display_name": "Chat User"},
    )
    user = db_session.query(User).filter(User.email == "chatuser@university.edu").first()
    client.post("/auth/verify-email", json={"token": user.verification_token})
    client.post("/auth/login", json={"email": "chatuser@university.edu", "password": "password123"})

    # The client's cookie jar now carries the session -- no token/headers to
    # thread through manually.
    room = client.post("/rooms", json={"name": "chat-test-room"}).json()
    return {"room_id": room["id"]}


def test_websocket_rejects_invalid_session(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/rooms/1", cookies={"access_token": "not-a-real-token"}):
            pass


def test_websocket_rejects_missing_room(client, logged_in_user):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/rooms/999999"):
            pass


def test_websocket_send_and_receive_broadcast(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "hey, anyone up for calc?"})
        received = ws.receive_json()

    assert received["content"] == "hey, anyone up for calc?"
    assert received["room_id"] == room_id
    assert received["display_name"] == "Chat User"
    assert "id" in received and "created_at" in received


def test_websocket_ignores_blank_messages(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "   "})
        ws.send_json({"content": "real message"})
        received = ws.receive_json()

    # The blank message should have been skipped, so the first thing
    # broadcast back is the real one.
    assert received["content"] == "real message"


def test_websocket_message_is_persisted(client, logged_in_user):
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}") as ws:
        ws.send_json({"content": "persisted message"})
        ws.receive_json()

    history = client.get(f"/rooms/{room_id}/messages").json()
    assert any(m["content"] == "persisted message" for m in history)


def test_websocket_rejects_after_token_revocation(client, db_session):
    client.post(
        "/auth/signup",
        json={"email": "revokews@university.edu", "password": "password123", "display_name": "Revoke Me"},
    )
    user = db_session.query(User).filter(User.email == "revokews@university.edu").first()
    client.post("/auth/verify-email", json={"token": user.verification_token})
    client.post("/auth/login", json={"email": "revokews@university.edu", "password": "password123"})
    old_cookie = client.cookies["access_token"]
    room = client.post("/rooms", json={"name": "revoke-ws-room"}).json()

    client.post("/auth/logout-all")

    # A copy of the pre-revocation token (as if cached in another browser)
    # must be rejected too, not just the current client's now-cleared cookie.
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/rooms/{room['id']}", cookies={"access_token": old_cookie}):
            pass
