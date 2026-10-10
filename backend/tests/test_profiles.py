from tests.conftest import make_token

PHOTO = "https://img.clerk.com/google-photo.png"


def test_profile_needs_sign_in(client):
    assert client.get("/me/profile").status_code == 401
    assert client.patch("/me/profile", json={"bio": "hi"}).status_code == 401
    assert client.get("/users/1/profile").status_code == 401


def test_own_profile_starts_anonymous_with_school_and_timezone(client, sign_in):
    sign_in("new.owl@harvard.edu", first_name="New")

    profile = client.get("/me/profile").json()

    assert profile["display_name"] == "new_owl"
    assert profile["name"] == "New"
    assert profile["show_name"] is False
    assert profile["avatar_url"] is None  # the pixel avatar
    assert profile["school_name"] == "Harvard University"
    assert profile["timezone"] == "America/New_York"
    assert profile["email"] == "new.owl@harvard.edu"


def test_school_comes_from_the_email_for_every_account(client, sign_in):
    owner = sign_in("old.bear@berkeley.edu")
    owner_id = owner.response.json()["id"]

    assert client.get("/me/profile").json()["school_name"] == "University of California-Berkeley"
    sign_in("viewer.bear@university.edu")
    assert client.get(f"/users/{owner_id}/profile").json()["school_name"] == "University of California-Berkeley"


def test_profile_works_outside_night_hours(client, sign_in, monkeypatch):
    sign_in("daytime@university.edu")
    monkeypatch.setattr("app.gate.is_night_in_timezone", lambda tz, now=None: False)

    assert client.get("/me/profile").status_code == 200
    assert client.patch("/me/profile", json={"bio": "studying all day"}).status_code == 200


def test_editing_the_profile(client, sign_in):
    sign_in("editor@university.edu")

    res = client.patch(
        "/me/profile",
        json={
            "display_name": "night_owl",
            "pronouns": "they/them",
            "bio": "late-night CS",
            "status": "studying",
            "major": "Computer Science",
            "year": "Junior",
            "interests": ["chess", "lofi", "chess"],
            "courses": ["CS 161"],
            "socials": {"github": {"handle": "@octocat", "visible": True}, "x": {"handle": "owl", "visible": False}},
            "projects": [{"title": "nightcord", "url": "https://example.com/nightcord"}],
        },
    )

    assert res.status_code == 200
    profile = res.json()
    assert profile["display_name"] == "night_owl"
    assert profile["interests"] == ["chess", "lofi"]  # duplicates dropped
    assert profile["socials"]["github"] == {"handle": "octocat", "visible": True}  # "@" dropped
    assert profile["projects"] == [{"title": "nightcord", "url": "https://example.com/nightcord"}]


def test_an_empty_string_clears_a_field(client, sign_in):
    sign_in("clearer@university.edu")
    client.patch("/me/profile", json={"bio": "something", "status": "studying"})

    profile = client.patch("/me/profile", json={"bio": "", "status": ""}).json()

    assert profile["bio"] is None
    assert profile["status"] is None


def test_invalid_profile_values_are_rejected(client, sign_in):
    sign_in("strict@university.edu")

    for bad in (
        {"display_name": "Has Spaces"},
        {"display_name": "ab"},
        {"bio": "x" * 161},
        {"year": "Super senior"},
        {"status": "asleep"},
        {"interests": ["t"] * 11},
        {"socials": {"github": {"handle": "not a handle!"}}},
        {"socials": {"myspace": {"handle": "tom"}}},
        {"projects": [{"title": "site", "url": "http://insecure.example"}]},
        {"projects": [{"title": f"p{n}", "url": "https://example.com"} for n in range(6)]},
    ):
        assert client.patch("/me/profile", json=bad).status_code == 422, bad


def test_usernames_are_unique(client, sign_in):
    sign_in("first@university.edu")
    client.patch("/me/profile", json={"display_name": "taken_name"})
    sign_in("second@university.edu")

    res = client.patch("/me/profile", json={"display_name": "taken_name"})

    assert res.status_code == 409


def test_photo_is_opt_in(client, sign_in):
    sign_in("google@university.edu", photo_url=PHOTO)
    profile = client.get("/me/profile").json()
    assert profile["avatar_url"] is None
    assert profile["photo_url"] == PHOTO

    assert client.patch("/me/profile", json={"use_photo": True}).json()["avatar_url"] == PHOTO
    assert client.patch("/me/profile", json={"use_photo": False}).json()["avatar_url"] is None


def test_no_photo_to_use_without_google_or_microsoft(client, sign_in):
    sign_in("emailonly@university.edu")
    assert client.patch("/me/profile", json={"use_photo": True}).status_code == 400


def test_public_profile_hides_what_isnt_shared(client, sign_in):
    owner = sign_in("owner@university.edu", first_name="Real Name")
    client.patch(
        "/me/profile",
        json={"socials": {"github": {"handle": "shown"}, "instagram": {"handle": "hidden", "visible": False}}},
    )
    owner_id = owner.response.json()["id"]
    sign_in("viewer@university.edu")

    public = client.get(f"/users/{owner_id}/profile").json()

    assert public["display_name"] == "owner"
    assert public["name"] is None  # show_name is off
    assert "email" not in public
    assert public["socials"] == {"github": "shown"}

    client.headers["Authorization"] = f"Bearer {make_token(owner.clerk_user_id)}"
    client.patch("/me/profile", json={"show_name": True})
    sign_in("viewer2@university.edu")
    assert client.get(f"/users/{owner_id}/profile").json()["name"] == "Real Name"


def test_public_profile_404(client, sign_in):
    sign_in("looker@university.edu")
    assert client.get("/users/999999/profile").status_code == 404


def test_avatar_shows_in_chat_history(client, sign_in, db_session):
    from app.models import Message, User

    sign_in("pic@university.edu", photo_url=PHOTO)
    client.patch("/me/profile", json={"use_photo": True})
    room = client.post("/rooms", json={"name": "avatar-room"}).json()
    user = db_session.query(User).filter(User.email == "pic@university.edu").first()
    db_session.add(Message(room_id=room["id"], user_id=user.id, content="hello"))
    db_session.commit()

    history = client.get(f"/rooms/{room['id']}/messages").json()

    assert history[-1]["avatar_url"] == PHOTO
