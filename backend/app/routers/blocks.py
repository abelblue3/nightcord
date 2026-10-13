from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Block, User
from app.rate_limit import limiter, user_or_ip_key
from app.schemas import BlockedStudentOut

# Blocking needs sign-in only -- not the night gate -- like profiles, so a
# student can manage it in the daytime too.
router = APIRouter(prefix="/me/blocks", tags=["blocks"])


@router.get("", response_model=list[BlockedStudentOut])
def list_blocks(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[User]:
    """The students you've blocked, most recent first."""
    return (
        db.query(User)
        .join(Block, Block.blocked_id == User.id)
        .filter(Block.blocker_id == user.id)
        .order_by(Block.created_at.desc())
        .all()
    )


@router.put("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute", key_func=user_or_ip_key)
def block(request: Request, user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    """Stops you seeing this student's messages and profile, and them
    opening yours. Blocking someone already blocked changes nothing."""
    if user_id == user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't block yourself.")
    if not db.get(User, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such student.")
    if not db.get(Block, (user.id, user_id)):
        db.add(Block(blocker_id=user.id, blocked_id=user_id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute", key_func=user_or_ip_key)
def unblock(request: Request, user_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    db.query(Block).filter(Block.blocker_id == user.id, Block.blocked_id == user_id).delete()
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
