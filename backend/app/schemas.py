import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field, StringConstraints, field_validator

from app.usernames import USERNAME_PATTERN

class SessionStart(BaseModel):
    # The browser's timezone, used only if the student's school has none on
    # record (see gate.resolve_signup_timezone).
    timezone: str | None = None

class EmailCheck(BaseModel):
    email: EmailStr

class EmailCheckOut(BaseModel):
    allowed: bool
    message: str | None

class ConsentIn(BaseModel):
    policy_version: str = Field(min_length=1, max_length=20)
    preferences: bool
    diagnostics: bool

class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    timezone: str | None
    avatar_url: str | None

    class Config:
        from_attributes = True


# --- profiles ---

Status = Literal["studying", "open_to_chat", "just_here"]
Year = Literal["Freshman", "Sophomore", "Junior", "Senior", "Grad", "Other"]
SocialKind = Literal["linkedin", "github", "instagram", "x", "discord", "website"]

# What a handle may look like on each site (a leading "@" is dropped first).
SOCIAL_HANDLE_PATTERNS = {
    "linkedin": re.compile(r"[A-Za-z0-9-]{3,100}"),  # linkedin.com/in/<handle>
    "github": re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"),
    "instagram": re.compile(r"[A-Za-z0-9._]{1,30}"),
    "x": re.compile(r"[A-Za-z0-9_]{1,15}"),
    "discord": re.compile(r"[a-z0-9_.]{2,32}"),
    "website": re.compile(r"https://[^\s<>\"']{4,200}"),
}


def _https_url(value: str) -> str:
    if not re.fullmatch(r"https://[^\s<>\"']{4,200}", value):
        raise ValueError("Links must start with https://")
    return value


ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=160)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]


class Social(BaseModel):
    handle: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    visible: bool = True


class Project(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    url: Annotated[str, StringConstraints(strip_whitespace=True), AfterValidator(_https_url)]


class ProfileUpdate(BaseModel):
    """Only the fields sent are changed; an empty string clears a text field."""

    display_name: str | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None = None
    show_name: bool | None = None
    pronouns: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)] | None = None
    bio: ShortText | None = None
    status: Status | Literal[""] | None = None
    major: Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)] | None = None
    year: Year | Literal[""] | None = None
    interests: list[Tag] | None = Field(default=None, max_length=10)
    courses: list[Tag] | None = Field(default=None, max_length=10)
    socials: dict[SocialKind, Social] | None = None
    projects: list[Project] | None = Field(default=None, max_length=5)
    use_photo: bool | None = None  # True: their Google/Microsoft photo; False: the pixel avatar

    @field_validator("display_name")
    @classmethod
    def valid_username(cls, value: str | None) -> str | None:
        if value is not None and not USERNAME_PATTERN.fullmatch(value):
            raise ValueError("Usernames are 3-20 lowercase letters, numbers or underscores.")
        return value

    @field_validator("socials")
    @classmethod
    def valid_handles(cls, value: dict | None) -> dict | None:
        for kind, social in (value or {}).items():
            social.handle = social.handle.removeprefix("@")
            if not SOCIAL_HANDLE_PATTERNS[kind].fullmatch(social.handle):
                raise ValueError(f"That doesn't look like a {kind} handle.")
        return value


class PublicProfileOut(BaseModel):
    """What other students see: never the email, the name only if shown, and
    only the socials marked visible."""

    id: int
    display_name: str
    name: str | None
    avatar_url: str | None
    school_name: str | None
    pronouns: str | None
    bio: str | None
    status: str | None
    major: str | None
    year: str | None
    interests: list[str]
    courses: list[str]
    socials: dict[str, str]  # kind -> handle
    projects: list[Project]


class OwnProfileOut(BaseModel):
    """Your own profile, including what's hidden from others."""

    id: int
    email: str
    display_name: str
    name: str | None
    show_name: bool
    avatar_url: str | None
    photo_url: str | None  # their Google/Microsoft photo, if any (for "use my photo")
    school_name: str | None
    timezone: str | None
    pronouns: str | None
    bio: str | None
    status: str | None
    major: str | None
    year: str | None
    interests: list[str]
    courses: list[str]
    socials: dict[str, Social]
    projects: list[Project]

class MessageResponse(BaseModel):
    message: str

class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

class RoomOut(BaseModel):
    id: int
    name: str
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True

class VideoTokenOut(BaseModel):
    url: str
    token: str

class MessageOut(BaseModel):
    id: int
    room_id: int
    user_id: int
    display_name: str
    avatar_url: str | None
    content: str
    created_at: datetime

    class Config:
        from_attributes = True