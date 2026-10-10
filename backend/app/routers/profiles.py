from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.rate_limit import limiter, user_or_ip_key
from app.schemas import OwnProfileOut, ProfileUpdate, PublicProfileOut

# Profiles need sign-in only -- not the night gate -- so a student can edit
# theirs in the daytime too.
router = APIRouter(tags=["profiles"])

TEXT_FIELDS = ("name", "pronouns", "bio", "status", "major", "year")
LIST_FIELDS = ("interests", "courses")


def own_profile(user: User) -> OwnProfileOut:
    return OwnProfileOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        name=user.name,
        show_name=user.show_name,
        avatar_url=user.avatar_url,
        photo_url=user.provider_photo_url,
        school_name=user.school_name,
        timezone=user.timezone,
        pronouns=user.pronouns,
        bio=user.bio,
        status=user.status,
        major=user.major,
        year=user.year,
        interests=user.interests or [],
        courses=user.courses or [],
        socials=user.socials or {},
        projects=user.projects or [],
    )


@router.get("/me/profile", response_model=OwnProfileOut)
def get_my_profile(user: User = Depends(get_current_user)) -> OwnProfileOut:
    return own_profile(user)


@router.patch("/me/profile", response_model=OwnProfileOut)
@limiter.limit("30/minute", key_func=user_or_ip_key)
def update_my_profile(
    request: Request,
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> OwnProfileOut:
    changes = payload.model_dump(exclude_unset=True)

    if "display_name" in changes and changes["display_name"] != user.display_name:
        taken = db.query(User.id).filter(User.display_name == changes["display_name"], User.id != user.id).first()
        if taken:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is taken.")
        user.display_name = changes["display_name"]

    for field in TEXT_FIELDS:
        if field in changes:
            setattr(user, field, changes[field] or None)  # "" clears it
    for field in LIST_FIELDS:
        if field in changes:
            setattr(user, field, list(dict.fromkeys(changes[field] or [])))  # without duplicates
    if "show_name" in changes and changes["show_name"] is not None:
        user.show_name = changes["show_name"]
    # Nested values are saved whole: exclude_unset would also drop their
    # defaults (e.g. a social's "visible").
    if "socials" in changes:
        user.socials = {kind: social.model_dump() for kind, social in (payload.socials or {}).items()}
    if "projects" in changes:
        user.projects = [project.model_dump() for project in payload.projects or []]
    if changes.get("use_photo") is not None:
        if changes["use_photo"] and not user.provider_photo_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="There's no Google or Microsoft photo on your account to use.",
            )
        user.avatar_url = user.provider_photo_url if changes["use_photo"] else None

    db.commit()
    db.refresh(user)
    return own_profile(user)


@router.get("/users/{user_id}/profile", response_model=PublicProfileOut)
@limiter.limit("60/minute", key_func=user_or_ip_key)
def get_public_profile(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> PublicProfileOut:
    person = db.get(User, user_id)
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such student.")
    return PublicProfileOut(
        id=person.id,
        display_name=person.display_name,
        name=person.name if person.show_name else None,
        avatar_url=person.avatar_url,
        school_name=person.school_name,
        pronouns=person.pronouns,
        bio=person.bio,
        status=person.status,
        major=person.major,
        year=person.year,
        interests=person.interests or [],
        courses=person.courses or [],
        socials={kind: s["handle"] for kind, s in (person.socials or {}).items() if s.get("visible")},
        projects=person.projects or [],
    )
