"""Idempotent maintenance script: creates (or confirms) the dedicated canary
account + room used by the scheduled canary checks (.github/workflows/canary.yml).

Bypasses the signup API entirely -- and therefore its .edu domain
validation -- since this is a synthetic monitoring account, not a student's.

Usage:
    DATABASE_URL=<target db> CANARY_EMAIL=... CANARY_PASSWORD=... \
        python scripts/seed_canary.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.auth import hash_password
from app.models import Room, User

DATABASE_URL = os.environ["DATABASE_URL"]
CANARY_EMAIL = os.environ.get("CANARY_EMAIL", "canary@nightcord.internal")
CANARY_PASSWORD = os.environ["CANARY_PASSWORD"]
CANARY_ROOM_NAME = "canary-room"

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)
db = Session()

user = db.query(User).filter(User.email == CANARY_EMAIL).first()
if user:
    print(f"canary user already exists: id={user.id}")
else:
    user = User(
        email=CANARY_EMAIL,
        hashed_password=hash_password(CANARY_PASSWORD),
        display_name="Canary",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    print(f"created canary user: id={user.id}")

room = db.query(Room).filter(Room.name == CANARY_ROOM_NAME).first()
if room:
    print(f"canary room already exists: id={room.id}")
else:
    room = Room(name=CANARY_ROOM_NAME, created_by=user.id)
    db.add(room)
    db.commit()
    db.refresh(room)
    print(f"created canary room: id={room.id}")

db.close()
print("done")
