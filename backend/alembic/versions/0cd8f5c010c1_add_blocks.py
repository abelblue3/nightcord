"""add blocks

Revision ID: 0cd8f5c010c1
Revises: dffe3dd3b34f
Create Date: 2026-10-13 08:13:11.504389

Students can block each other: the blocker stops seeing the blocked
student's messages and profile. One row per (blocker, blocked) pair.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0cd8f5c010c1'
down_revision: Union[str, None] = 'dffe3dd3b34f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'blocks',
        sa.Column('blocker_id', sa.Integer(), nullable=False),
        sa.Column('blocked_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['blocker_id'], ['users.id']),
        sa.ForeignKeyConstraint(['blocked_id'], ['users.id']),
        sa.PrimaryKeyConstraint('blocker_id', 'blocked_id'),
    )
    op.create_index(op.f('ix_blocks_blocked_id'), 'blocks', ['blocked_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_blocks_blocked_id'), table_name='blocks')
    op.drop_table('blocks')
