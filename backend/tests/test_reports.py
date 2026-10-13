"""Reports: who reported whom and why, with a copy of the room's recent
messages for whoever reviews it."""


def _students(sign_in, *emails):
    """Signs each student in and returns (id, token) pairs; the client is left
    signed in as the last one."""
    people = []
    for email in emails:
        signed_in = sign_in(email)
        people.append((signed_in.response.json()["id"], signed_in.token))
    return people


def _act_as(client, token):
    client.headers["Authorization"] = f"Bearer {token}"


def _seed(db_session, room_id, author_id, count, start=0):
    from app.models import Message

    messages = [Message(room_id=room_id, user_id=author_id, content=f"msg {start + n}") for n in range(count)]
    db_session.add_all(messages)
    db_session.commit()
    return [m.id for m in messages]


def _reports(db_session):
    from app.models import Report

    db_session.expire_all()
    return db_session.query(Report).order_by(Report.id).all()


def test_reporting_needs_sign_in(client):
    assert client.post("/reports", json={"reported_id": 1, "reason": "spam"}).status_code == 401


def test_report_a_message_keeps_a_copy_of_the_messages_up_to_it(client, sign_in, db_session):
    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "reported-room"}).json()
    ids = _seed(db_session, room["id"], bob, 60)
    _seed(db_session, room["id"], bob, 5, start=60)  # sent after the reported message

    res = client.post(
        "/reports",
        json={"reported_id": bob, "room_id": room["id"], "message_id": ids[-1], "reason": "harassment", "details": "  rude  "},
    )

    assert res.status_code == 201
    assert res.json() == {"message": "Report received."}  # no messages handed back
    [report] = _reports(db_session)
    assert (report.reporter_id, report.reported_id, report.room_id) == (alice, bob, room["id"])
    assert (report.reason, report.details, report.status) == ("harassment", "rude", "open")
    assert [m["content"] for m in report.snapshot] == [f"msg {n}" for n in range(10, 60)]
    assert report.snapshot[-1]["id"] == ids[-1]
    assert report.snapshot[0]["display_name"] == "bob"


def test_report_from_a_room_without_a_message_copies_the_latest(client, sign_in, db_session):
    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "room-only"}).json()
    _seed(db_session, room["id"], bob, 3)

    assert client.post("/reports", json={"reported_id": bob, "room_id": room["id"], "reason": "spam"}).status_code == 201
    assert [m["content"] for m in _reports(db_session)[0].snapshot] == ["msg 0", "msg 1", "msg 2"]


def test_report_from_a_profile_has_no_snapshot(client, sign_in, db_session):
    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)

    assert client.post("/reports", json={"reported_id": bob, "reason": "other"}).status_code == 201
    [report] = _reports(db_session)
    assert report.room_id is None and report.snapshot == []


def test_snapshot_includes_people_the_reporter_blocked(client, sign_in, db_session):
    (alice, alice_token), (bob, _), (carol, _) = _students(
        sign_in, "alice@university.edu", "bob@university.edu", "carol@university.edu"
    )
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "full-context"}).json()
    _seed(db_session, room["id"], carol, 1)
    client.put(f"/me/blocks/{carol}")

    client.post("/reports", json={"reported_id": bob, "room_id": room["id"], "reason": "spam"})
    assert [m["user_id"] for m in _reports(db_session)[0].snapshot] == [carol]


def test_bad_reports_are_refused(client, sign_in, db_session):
    (alice, alice_token), (bob, _), (carol, _) = _students(
        sign_in, "alice@university.edu", "bob@university.edu", "carol@university.edu"
    )
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "checks"}).json()
    other = client.post("/rooms", json={"name": "elsewhere"}).json()
    [carols] = _seed(db_session, room["id"], carol, 1)
    [bobs_elsewhere] = _seed(db_session, other["id"], bob, 1)

    def report(**body):
        return client.post("/reports", json={"reason": "spam", **body}).status_code

    assert report(reported_id=alice) == 400  # yourself
    assert report(reported_id=999999) == 404
    assert report(reported_id=bob, room_id=999999) == 404
    assert report(reported_id=bob, room_id=room["id"], message_id=carols) == 400  # someone else's message
    assert report(reported_id=bob, room_id=room["id"], message_id=bobs_elsewhere) == 400  # another room
    assert report(reported_id=bob, message_id=carols) == 422  # a message needs its room
    assert report(reported_id=bob, reason="annoying") == 422  # not one of the reasons
    assert client.post("/reports", json={"reported_id": bob, "reason": "other", "details": "x" * 501}).status_code == 422
    assert _reports(db_session) == []


def test_reporting_works_outside_night_hours(client, sign_in, monkeypatch):
    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)

    assert client.post("/reports", json={"reported_id": bob, "reason": "spam"}).status_code == 201


def test_reports_are_limited_per_account(client, sign_in):
    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)

    codes = [client.post("/reports", json={"reported_id": bob, "reason": "spam"}).status_code for _ in range(11)]
    assert codes == [201] * 10 + [429]
