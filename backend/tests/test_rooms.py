import pytest


@pytest.fixture()
def logged_in_room_user(client):
    client.post(
        "/auth/signup",
        json={"email": "roomuser@university.edu", "password": "password123", "display_name": "Room User"},
    )


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


def test_create_room_requires_csrf_header(client, logged_in_room_user):
    res = client.post("/rooms", json={"name": "csrf-room"}, headers={"X-Requested-With": "not-nightcord"})
    assert res.status_code == 403


def test_room_messages_empty_initially(client, logged_in_room_user):
    room = client.post("/rooms", json={"name": "empty-room"}).json()
    res = client.get(f"/rooms/{room['id']}/messages")
    assert res.status_code == 200
    assert res.json() == []


def test_room_messages_404_for_missing_room(client, logged_in_room_user):
    res = client.get("/rooms/999999/messages")
    assert res.status_code == 404
