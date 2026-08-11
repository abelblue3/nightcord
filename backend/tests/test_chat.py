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

    login_res = client.post("/auth/login", json={"email": "chatuser@university.edu", "password": "password123"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    room = client.post("/rooms", json={"name": "chat-test-room"}, headers=headers).json()
    return {"token": token, "headers": headers, "room_id": room["id"]}


def test_websocket_rejects_invalid_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/rooms/1?token=not-a-real-token"):
            pass


def test_websocket_rejects_missing_room(client, logged_in_user):
    token = logged_in_user["token"]
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/rooms/999999?token={token}"):
            pass


def test_websocket_send_and_receive_broadcast(client, logged_in_user):
    token = logged_in_user["token"]
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}?token={token}") as ws:
        ws.send_json({"content": "hey, anyone up for calc?"})
        received = ws.receive_json()

    assert received["content"] == "hey, anyone up for calc?"
    assert received["room_id"] == room_id
    assert received["display_name"] == "Chat User"
    assert "id" in received and "created_at" in received


def test_websocket_ignores_blank_messages(client, logged_in_user):
    token = logged_in_user["token"]
    room_id = logged_in_user["room_id"]

    with client.websocket_connect(f"/ws/rooms/{room_id}?token={token}") as ws:
        ws.send_json({"content": "   "})
        ws.send_json({"content": "real message"})
        received = ws.receive_json()

    # The blank message should have been skipped, so the first thing
    # broadcast back is the real one.
    assert received["content"] == "real message"


def test_websocket_message_is_persisted(client, logged_in_user):
    token = logged_in_user["token"]
    room_id = logged_in_user["room_id"]
    headers = logged_in_user["headers"]

    with client.websocket_connect(f"/ws/rooms/{room_id}?token={token}") as ws:
        ws.send_json({"content": "persisted message"})
        ws.receive_json()

    history = client.get(f"/rooms/{room_id}/messages", headers=headers).json()
    assert any(m["content"] == "persisted message" for m in history)
