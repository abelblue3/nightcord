from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=100)
    timezone: str | None = None


class UserOut(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    timezone: str | None
    is_verified: bool

    class Config:
        from_attributes = True


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class GoogleAuthRequest(BaseModel):
    credential: str


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
    content: str
    created_at: datetime

    class Config:
        from_attributes = True
