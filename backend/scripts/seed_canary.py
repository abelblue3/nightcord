"""Idempotent maintenance script: creates (or confirms) the dedicated canary
account + room used by the scheduled canary checks (.github/workflows/canary.yml).

The canary signs in through Clerk like everyone else, so its nightcord row
is linked to a Clerk user created for it in the Clerk dashboard. It's written
here directly instead of through POST /auth/session: that endpoint only
admits .edu students, and this is a synthetic monitoring account.

Usage:
    DATABASE_URL=<target db> CANARY_CLERK_USER_ID=user_... [CANARY_EMAIL=...] \\
        python scripts/seed_canary.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Room, User

DATABASE_URL = os.environ["DATABASE_URL"]
CANARY_CLERK_USER_ID = os.environ["CANARY_CLERK_USER_ID"]
CANARY_EMAIL = os.environ.get("CANARY_EMAIL", "canary@nightcord.internal")
CANARY_ROOM_NAME = "canary-room"

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)
db = Session()

user = db.query(User).filter(User.email == CANARY_EMAIL).first()
if user:
    if user.clerk_user_id != CANARY_CLERK_USER_ID:
        user.clerk_user_id = CANARY_CLERK_USER_ID
        db.commit()
        print(f"linked canary user id={user.id} to Clerk user {CANARY_CLERK_USER_ID}")
    else:
        print(f"canary user already exists: id={user.id}")
else:
    user = User(email=CANARY_EMAIL, clerk_user_id=CANARY_CLERK_USER_ID, display_name="Canary")
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
