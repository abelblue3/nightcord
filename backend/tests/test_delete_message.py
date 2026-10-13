"""Deleting your own message: gone from history, and gone live for everyone
in the room."""


def _students(sign_in, *emails):
    people = []
    for email in emails:
        signed_in = sign_in(email)
        people.append((signed_in.response.json()["id"], signed_in.token))
    return people


def _act_as(client, token):
    client.headers["Authorization"] = f"Bearer {token}"


def _message(db_session, room_id, user_id, content="oops"):
    from app.models import Message

    message = Message(room_id=room_id, user_id=user_id, content=content)
    db_session.add(message)
    db_session.commit()
    return message.id


def test_deleting_needs_sign_in(client):
    assert client.delete("/rooms/1/messages/1").status_code == 401


def test_delete_your_own_message(client, sign_in, db_session):
    (alice, alice_token), = _students(sign_in, "alice@university.edu")
    room = client.post("/rooms", json={"name": "oops-room"}).json()
    keep = _message(db_session, room["id"], alice, "keep me")
    gone = _message(db_session, room["id"], alice, "oops")

    assert client.delete(f"/rooms/{room['id']}/messages/{gone}").status_code == 204
    assert [m["id"] for m in client.get(f"/rooms/{room['id']}/messages").json()] == [keep]


def test_cannot_delete_someone_elses_message(client, sign_in, db_session):
    (alice, alice_token), (bob, bob_token) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "not-yours"}).json()
    alices = _message(db_session, room["id"], alice)

    _act_as(client, bob_token)
    res = client.delete(f"/rooms/{room['id']}/messages/{alices}")
    assert res.status_code == 403
    assert res.json()["detail"] == "You can only delete your own messages."
    assert len(client.get(f"/rooms/{room['id']}/messages").json()) == 1


def test_unknown_message_or_wrong_room_is_404(client, sign_in, db_session):
    (alice, _), = _students(sign_in, "alice@university.edu")
    room = client.post("/rooms", json={"name": "here"}).json()
    other = client.post("/rooms", json={"name": "there"}).json()
    elsewhere = _message(db_session, other["id"], alice)

    assert client.delete(f"/rooms/{room['id']}/messages/999999").status_code == 404
    assert client.delete(f"/rooms/{room['id']}/messages/{elsewhere}").status_code == 404


def test_deleting_works_outside_night_hours(client, sign_in, db_session, monkeypatch):
    (alice, _), = _students(sign_in, "alice@university.edu")
    room = client.post("/rooms", json={"name": "daytime-delete"}).json()
    mine = _message(db_session, room["id"], alice)
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)

    assert client.delete(f"/rooms/{room['id']}/messages/{mine}").status_code == 204


def test_everyone_in_the_room_is_told(client, sign_in, db_session, room_socket):
    (alice, alice_token), (bob, bob_token) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "live-delete"}).json()
    mine = _message(db_session, room["id"], alice)

    with room_socket(room["id"], token=bob_token) as bobs_page:
        assert client.delete(f"/rooms/{room['id']}/messages/{mine}").status_code == 204
        assert bobs_page.receive_json() == {"type": "deleted", "id": mine, "room_id": room["id"]}


def test_deletes_are_limited_per_account(client, sign_in, db_session):
    (alice, _), = _students(sign_in, "alice@university.edu")
    room = client.post("/rooms", json={"name": "many-deletes"}).json()
    ids = [_message(db_session, room["id"], alice) for _ in range(31)]

    codes = [client.delete(f"/rooms/{room['id']}/messages/{i}").status_code for i in ids]
    assert codes == [204] * 30 + [429]
