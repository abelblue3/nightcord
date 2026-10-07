import pytest

from app.models import ConsentRecord

CHOICE = {"policy_version": "2026-10-01", "preferences": True, "diagnostics": False}


def test_consent_requires_sign_in(client):
    assert client.post("/consent", json=CHOICE).status_code == 401


def test_each_choice_is_kept_as_history(client, db_session, sign_in):
    sign_in("consenter@university.edu")

    assert client.post("/consent", json=CHOICE).status_code == 201
    assert client.post("/consent", json={**CHOICE, "diagnostics": True}).status_code == 201

    rows = db_session.query(ConsentRecord).order_by(ConsentRecord.id).all()
    assert [(r.preferences, r.diagnostics, r.policy_version) for r in rows] == [
        (True, False, "2026-10-01"),
        (True, True, "2026-10-01"),
    ]
    assert rows[0].user_id == rows[1].user_id
    assert rows[0].created_at is not None


@pytest.mark.parametrize(
    "body",
    [
        {"preferences": True, "diagnostics": False},  # no policy version
        {**CHOICE, "policy_version": ""},
        {**CHOICE, "policy_version": "x" * 21},
        {"policy_version": "2026-10-01", "preferences": True},  # missing a category
    ],
)
def test_consent_body_is_validated(client, sign_in, body):
    sign_in("validator@university.edu")
    assert client.post("/consent", json=body).status_code == 422


def test_consent_is_rate_limited(client, sign_in):
    sign_in("clicker@university.edu")
    statuses = [client.post("/consent", json=CHOICE).status_code for _ in range(31)]
    assert statuses[-1] == 429
