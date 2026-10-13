"""Deleting your account: Clerk first, then the nightcord row is wiped.
Messages stay, shown as "deleted student"; reports and consent records stay."""

from app.clerk_auth import ClerkAPIError


def _students(sign_in, *emails):
    people = []
    for email in emails:
        signed_in = sign_in(email)
        people.append((signed_in.response.json()["id"], signed_in.token, signed_in.clerk_user_id))
    return people


def _act_as(client, token):
    client.headers["Authorization"] = f"Bearer {token}"


def _message(db_session, room_id, user_id, content="hello"):
    from app.models import Message

    db_session.add(Message(room_id=room_id, user_id=user_id, content=content))
    db_session.commit()


def test_deleting_needs_sign_in(client):
    assert client.delete("/me").status_code == 401


def test_delete_account_wipes_it_and_keeps_messages_as_deleted_student(client, sign_in, db_session, fake_clerk):
    (alice, alice_token, alice_clerk), (bob, bob_token, _) = _students(
        sign_in, "alice@university.edu", "bob@university.edu"
    )
    _act_as(client, alice_token)
    client.patch("/me/profile", json={"bio": "night owl", "socials": {"github": {"handle": "alice"}}})
    room = client.post("/rooms", json={"name": "still-here"}).json()
    _message(db_session, room["id"], alice, "my last words")

    assert client.delete("/me").status_code == 204
    assert fake_clerk.deleted == [alice_clerk]

    # Her token no longer reaches an account.
    assert client.get("/me/profile").status_code == 401

    _act_as(client, bob_token)
    [msg] = client.get(f"/rooms/{room['id']}/messages").json()
    assert (msg["content"], msg["display_name"], msg["avatar_url"]) == ("my last words", "deleted student", None)
    assert client.get(f"/users/{alice}/profile").status_code == 404
    assert client.put(f"/me/blocks/{alice}").status_code == 404

    from app.models import User

    db_session.expire_all()
    row = db_session.get(User, alice)
    assert row.deleted_at is not None and row.clerk_user_id is None
    assert row.email == f"deleted-{alice}@deleted.invalid"
    assert row.display_name == f"deleted-{alice}"  # not a valid username, so it can never collide
    assert (row.bio, row.socials, row.name, row.timezone) == (None, None, None, None)


def test_clerk_down_changes_nothing(client, sign_in, fake_clerk, monkeypatch):
    (alice, alice_token, _), = _students(sign_in, "alice@university.edu")

    def down(user_id):
        raise ClerkAPIError("down")

    monkeypatch.setattr("app.clerk_auth.delete_user", down)

    res = client.delete("/me")
    assert res.status_code == 502
    assert client.get("/me/profile").json()["display_name"] == "alice"


def test_blocks_go_reports_and_consent_stay(client, sign_in, db_session):
    from app.models import Block, ConsentRecord, Report

    (alice, alice_token, _), (bob, bob_token, _) = _students(sign_in, "alice@university.edu", "bob@university.edu")
    _act_as(client, bob_token)
    client.put(f"/me/blocks/{alice}")
    client.post("/reports", json={"reported_id": alice, "reason": "spam"})
    _act_as(client, alice_token)
    client.put(f"/me/blocks/{bob}")
    client.post("/consent", json={"policy_version": "2026-10-13", "preferences": True, "diagnostics": False})

    client.delete("/me")

    db_session.expire_all()
    assert db_session.query(Block).count() == 0
    assert db_session.query(Report).filter(Report.reported_id == alice).count() == 1
    assert db_session.query(ConsentRecord).filter(ConsentRecord.user_id == alice).count() == 1


def test_the_same_email_can_sign_up_again_as_a_new_account(client, sign_in):
    (alice, alice_token, _), = _students(sign_in, "alice@university.edu")
    client.patch("/me/profile", json={"bio": "first life"})
    client.delete("/me")

    again = sign_in("alice@university.edu")

    assert again.response.status_code == 200
    assert again.response.json()["id"] != alice
    profile = client.get("/me/profile").json()
    assert (profile["display_name"], profile["bio"]) == ("alice", None)  # the old username is free again


def test_deleting_works_outside_night_hours(client, sign_in, monkeypatch):
    _students(sign_in, "alice@university.edu")
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)

    assert client.delete("/me").status_code == 204


def test_delete_attempts_are_limited(client, sign_in, fake_clerk, monkeypatch):
    _students(sign_in, "alice@university.edu")

    def down(user_id):
        raise ClerkAPIError("down")

    monkeypatch.setattr("app.clerk_auth.delete_user", down)

    codes = [client.delete("/me").status_code for _ in range(6)]
    assert codes == [502] * 5 + [429]
