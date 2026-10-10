"""profiles

Revision ID: e5ccabf5357a
Revises: 569f3861eece
Create Date: 2026-10-09T00:00:00.000000

Student profiles. display_name becomes the username everyone sees: 3-20
lowercase letters, digits and underscores, unique -- existing names are
converted to that shape here (numbered when two collide). Then the optional
profile fields are added.
"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5ccabf5357a'
down_revision: Union[str, None] = '569f3861eece'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The same rules as app/usernames.py, copied so this migration keeps working
# whatever that module becomes.
def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")[:20].rstrip("_")
    return slug if len(slug) >= 3 else f"{slug}_owl".lstrip("_")


def upgrade() -> None:
    connection = op.get_bind()
    users = connection.execute(sa.text("SELECT id, display_name FROM users ORDER BY id")).fetchall()
    taken: set[str] = set()
    for user_id, display_name in users:
        base = _slugify(display_name)
        candidate, number = base, 2
        while candidate in taken:
            suffix = str(number)
            candidate = base[: 20 - len(suffix)] + suffix
            number += 1
        taken.add(candidate)
        connection.execute(
            sa.text("UPDATE users SET display_name = :name WHERE id = :id"), {"name": candidate, "id": user_id}
        )

    op.alter_column('users', 'display_name', existing_type=sa.String(length=100), type_=sa.String(length=20),
                    existing_nullable=False)
    op.create_index(op.f('ix_users_display_name'), 'users', ['display_name'], unique=True)

    op.add_column('users', sa.Column('name', sa.String(length=100), nullable=True))
    op.add_column('users', sa.Column('show_name', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('avatar_url', sa.String(length=500), nullable=True))
    op.add_column('users', sa.Column('provider_photo_url', sa.String(length=500), nullable=True))
    op.add_column('users', sa.Column('school_name', sa.String(length=200), nullable=True))
    op.add_column('users', sa.Column('pronouns', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('bio', sa.String(length=160), nullable=True))
    op.add_column('users', sa.Column('status', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('major', sa.String(length=60), nullable=True))
    op.add_column('users', sa.Column('year', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('interests', sa.JSON(), nullable=True))
    op.add_column('users', sa.Column('courses', sa.JSON(), nullable=True))
    op.add_column('users', sa.Column('socials', sa.JSON(), nullable=True))
    op.add_column('users', sa.Column('projects', sa.JSON(), nullable=True))


def downgrade() -> None:
    for column in ('projects', 'socials', 'courses', 'interests', 'year', 'major', 'status', 'bio', 'pronouns',
                   'school_name', 'provider_photo_url', 'avatar_url', 'show_name', 'name'):
        op.drop_column('users', column)
    op.drop_index(op.f('ix_users_display_name'), table_name='users')
    op.alter_column('users', 'display_name', existing_type=sa.String(length=20), type_=sa.String(length=100),
                    existing_nullable=False)
