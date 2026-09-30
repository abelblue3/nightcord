import pytest


@pytest.fixture()
def logged_in_room_user(client):
    client.post(
        "/auth/signup",
        json={"email": "roomuser@university.edu", "password": "correct-horse-battery", "display_name": "Room User"},
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


# --- rate limits ---


def _signup(client, email):
    client.post("/auth/signup", json={"email": email, "password": "correct-horse-battery", "display_name": email})


def test_room_creation_is_limited_per_account(client):
    _signup(client, "maker@university.edu")
    statuses = [client.post("/rooms", json={"name": f"room-{n}"}).status_code for n in range(11)]
    assert statuses[:10] == [201] * 10
    assert statuses[10] == 429
    assert client.post("/rooms", json={"name": "one-more"}).json()["detail"].startswith("Too many requests")

    # A different student on the same network (same IP here) has their own allowance.
    _signup(client, "other.maker@university.edu")
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
