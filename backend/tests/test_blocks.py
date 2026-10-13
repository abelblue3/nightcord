"""Blocking: when A blocks B, A stops seeing B's messages (history and live)
and B's profile, and B can't open A's profile. B still sees A's messages.
"""


def _students(sign_in, *emails):
    """Signs each student in and returns (id, token) pairs; the client is left
    signed in as the first one."""
    people = []
    for email in emails:
        signed_in = sign_in(email)
        people.append((signed_in.response.json()["id"], signed_in.token))
    return people


def _act_as(client, token):
    client.headers["Authorization"] = f"Bearer {token}"


def test_blocks_need_sign_in(client):
    assert client.get("/me/blocks").status_code == 401
    assert client.put("/me/blocks/1").status_code == 401
    assert client.delete("/me/blocks/1").status_code == 401


def test_block_list_and_unblock(client, sign_in):
    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)

    assert client.put(f"/me/blocks/{bob}").status_code == 204
    assert client.put(f"/me/blocks/{bob}").status_code == 204  # blocking twice is fine
    assert [p["id"] for p in client.get("/me/blocks").json()] == [bob]
    assert client.get("/me/blocks").json()[0]["display_name"] == "bob"

    assert client.delete(f"/me/blocks/{bob}").status_code == 204
    assert client.delete(f"/me/blocks/{bob}").status_code == 204  # and unblocking twice
    assert client.get("/me/blocks").json() == []


def test_cannot_block_yourself_or_nobody(client, sign_in):
    (alice, _), = _students(sign_in, "alice@university.edu")

    assert client.put(f"/me/blocks/{alice}").status_code == 400
    assert client.put("/me/blocks/999999").status_code == 404


def test_blocking_works_outside_night_hours(client, sign_in, monkeypatch):
    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)

    assert client.put(f"/me/blocks/{bob}").status_code == 204


def test_history_hides_blocked_authors_and_keeps_full_pages(client, sign_in, db_session):
    from app.models import Message

    (alice, alice_token), (bob, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "blocked-history"}).json()
    # 60 of Alice's own messages with Bob's in between.
    for n in range(60):
        db_session.add(Message(room_id=room["id"], user_id=alice, content=f"alice {n}"))
        db_session.add(Message(room_id=room["id"], user_id=bob, content=f"bob {n}"))
    db_session.commit()

    client.put(f"/me/blocks/{bob}")
    page = client.get(f"/rooms/{room['id']}/messages").json()

    # A full page of 50, none of them Bob's, so "Load earlier" still shows.
    assert len(page) == 50
    assert all(m["user_id"] == alice for m in page)
    older = client.get(f"/rooms/{room['id']}/messages", params={"before": page[0]["id"]}).json()
    assert [m["content"] for m in older] == [f"alice {n}" for n in range(10)]
    newer = client.get(f"/rooms/{room['id']}/messages", params={"after": older[-1]["id"]}).json()
    assert all(m["user_id"] == alice for m in newer)


def test_blocked_student_still_sees_the_blocker(client, sign_in, db_session):
    from app.models import Message

    (alice, alice_token), (bob, bob_token) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "one-way"}).json()
    db_session.add(Message(room_id=room["id"], user_id=alice, content="hi from alice"))
    db_session.commit()
    client.put(f"/me/blocks/{bob}")

    _act_as(client, bob_token)
    assert [m["content"] for m in client.get(f"/rooms/{room['id']}/messages").json()] == ["hi from alice"]


def test_profiles_hidden_both_ways(client, sign_in):
    (alice, alice_token), (bob, bob_token), (carol, _) = _students(
        sign_in, "alice@university.edu", "bob@university.edu", "carol@university.edu"
    )
    _act_as(client, alice_token)
    client.put(f"/me/blocks/{bob}")

    assert client.get(f"/users/{bob}/profile").status_code == 404
    assert client.get(f"/users/{carol}/profile").status_code == 200
    _act_as(client, bob_token)
    assert client.get(f"/users/{alice}/profile").status_code == 404


def test_live_messages_from_a_blocked_student_skip_the_blocker(client, sign_in, room_socket):
    (alice, alice_token), (bob, bob_token), (carol, carol_token) = _students(
        sign_in, "alice@university.edu", "bob@university.edu", "carol@university.edu"
    )
    _act_as(client, alice_token)
    room = client.post("/rooms", json={"name": "blocked-live"}).json()

    with room_socket(room["id"], token=alice_token) as a, room_socket(room["id"], token=bob_token) as b, room_socket(
        room["id"], token=carol_token
    ) as c:
        # Blocked while everyone is connected: applies to the next message.
        assert client.put(f"/me/blocks/{bob}").status_code == 204

        b.send_json({"content": "from bob"})
        assert c.receive_json()["content"] == "from bob"
        assert b.receive_json()["content"] == "from bob"

        c.send_json({"content": "from carol"})
        # Alice's next message is Carol's: Bob's was never sent to her.
        assert a.receive_json()["content"] == "from carol"
