"""index messages by room

Revision ID: 632c015fdfca
Revises: c4d1e8f3a920
Create Date: 2026-10-08T00:00:00.000000

Chat history pages through one room's messages newest-first
(WHERE room_id = ? AND id < ? ORDER BY id DESC); without this index that
scans the whole messages table as it grows.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '632c015fdfca'
down_revision: Union[str, None] = 'c4d1e8f3a920'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_messages_room_id_id', 'messages', ['room_id', 'id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_messages_room_id_id', table_name='messages')
