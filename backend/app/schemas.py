from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

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

    class Config:
        from_attributes = True

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

class MessageOut(BaseModel):
    id: int
    room_id: int
    user_id: int
    display_name: str
    content: str
    created_at: datetime

    class Config:
        from_attributes = True