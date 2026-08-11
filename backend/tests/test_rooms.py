import pytest

from app.models import User


@pytest.fixture()
def auth_headers(client, db_session):
    client.post(
        "/auth/signup",
        json={"email": "roomuser@university.edu", "password": "password123", "display_name": "Room User"},
    )
    user = db_session.query(User).filter(User.email == "roomuser@university.edu").first()
    client.post("/auth/verify-email", json={"token": user.verification_token})

    login_res = client.post("/auth/login", json={"email": "roomuser@university.edu", "password": "password123"})
    token = login_res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_rooms_require_auth(client):
    assert client.get("/rooms").status_code == 401
    assert client.post("/rooms", json={"name": "no-auth-room"}).status_code == 401


def test_create_and_list_rooms(client, auth_headers):
    create_res = client.post("/rooms", json={"name": "late-night-calc"}, headers=auth_headers)
    assert create_res.status_code == 201
    assert create_res.json()["name"] == "late-night-calc"

    list_res = client.get("/rooms", headers=auth_headers)
    assert list_res.status_code == 200
    names = [r["name"] for r in list_res.json()]
    assert "late-night-calc" in names


def test_create_room_rejects_duplicate_name(client, auth_headers):
    client.post("/rooms", json={"name": "dup-room"}, headers=auth_headers)
    res = client.post("/rooms", json={"name": "dup-room"}, headers=auth_headers)
    assert res.status_code == 409


def test_room_messages_empty_initially(client, auth_headers):
    room = client.post("/rooms", json={"name": "empty-room"}, headers=auth_headers).json()
    res = client.get(f"/rooms/{room['id']}/messages", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == []


def test_room_messages_404_for_missing_room(client, auth_headers):
    res = client.get("/rooms/999999/messages", headers=auth_headers)
    assert res.status_code == 404
