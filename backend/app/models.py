from datetime import datetime, timezone
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, false
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    """Some DB drivers (e.g. SQLite) drop tzinfo on round-trip; treat naive values as UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # Set the first time this person signs in through Clerk. The database still
    # holds the pre-Clerk columns (hashed_password, google_id,
    # failed_login_attempts, lockout_until, token_version) so a rollback stays
    # possible; nothing reads them, and a later migration drops them.
    clerk_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    # The username everyone sees (app/usernames.py has the rules).
    display_name: Mapped[str] = mapped_column(String(20), nullable=False, unique=True, index=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # Profile. Everything is optional; the real name shows only with
    # show_name, and each social only when marked visible.
    name: Mapped[str | None] = mapped_column(String(100))
    show_name: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=false())
    avatar_url: Mapped[str | None] = mapped_column(String(500))  # None: the pixel avatar
    # The Google/Microsoft photo Clerk has for them (refreshed at each
    # sign-in); used as avatar_url only if they opt in.
    provider_photo_url: Mapped[str | None] = mapped_column(String(500))
    school_name: Mapped[str | None] = mapped_column(String(200))  # from the email's domain, never typed
    pronouns: Mapped[str | None] = mapped_column(String(20))
    bio: Mapped[str | None] = mapped_column(String(160))
    status: Mapped[str | None] = mapped_column(String(20))
    major: Mapped[str | None] = mapped_column(String(60))
    year: Mapped[str | None] = mapped_column(String(20))
    interests: Mapped[list | None] = mapped_column(JSON)  # ["chess", ...]
    courses: Mapped[list | None] = mapped_column(JSON)  # ["CS 161", ...]
    socials: Mapped[dict | None] = mapped_column(JSON)  # {"github": {"handle": "...", "visible": true}}
    projects: Mapped[list | None] = mapped_column(JSON)  # [{"title": "...", "url": "https://..."}]

    messages: Mapped[list["Message"]] = relationship(back_populates="author")


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    messages: Mapped[list["Message"]] = relationship(back_populates="room")


class Message(Base):
    __tablename__ = "messages"
    # History pages through one room's messages by id.
    __table_args__ = (Index("ix_messages_room_id_id", "room_id", "id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(String(2000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    room: Mapped["Room"] = relationship(back_populates="messages")
    author: Mapped["User"] = relationship(back_populates="messages")

    @property
    def display_name(self) -> str:
        """Lets MessageOut (from_attributes) include the author's name, so
        chat history shows the same names live messages do.
        """
        return self.author.display_name

    @property
    def avatar_url(self) -> str | None:
        return self.author.avatar_url


class ConsentRecord(Base):
    """One row per cookie/data choice a signed-in student makes -- never
    updated, so the history shows what they agreed to and when (proof of
    consent). Essential storage isn't recorded: it isn't optional.
    """

    __tablename__ = "consent_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    policy_version: Mapped[str] = mapped_column(String(20), nullable=False)
    preferences: Mapped[bool] = mapped_column(Boolean, nullable=False)
    diagnostics: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
