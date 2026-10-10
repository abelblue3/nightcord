"""Usernames: the name everyone sees in chat and on profiles (stored in
users.display_name). 3-20 lowercase letters, digits and underscores, unique.
"""
import re

from sqlalchemy.orm import Session

from app.models import User

MIN_LENGTH = 3
MAX_LENGTH = 20
USERNAME_PATTERN = re.compile(rf"[a-z0-9_]{{{MIN_LENGTH},{MAX_LENGTH}}}")


def slugify(text: str) -> str:
    """Any text -> a valid username shape: 'Abel.Milkrick' -> 'abel_milkrick'."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:MAX_LENGTH].rstrip("_")
    return slug if len(slug) >= MIN_LENGTH else f"{slug}_owl".lstrip("_")


def available_username(db: Session, wanted: str) -> str:
    """`wanted` made valid, with a number added if someone already has it."""
    base = slugify(wanted)
    candidate, number = base, 2
    while db.query(User.id).filter(User.display_name == candidate).first():
        suffix = str(number)
        candidate = base[: MAX_LENGTH - len(suffix)] + suffix
        number += 1
    return candidate
