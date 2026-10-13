"""add reports

Revision ID: d1d989cd75d8
Revises: 0cd8f5c010c1
Create Date: 2026-10-13 09:24:32.968167

Students can report each other. Each report keeps a copy of the room's
recent messages (snapshot) for whoever reviews it; message_id has no foreign
key so the report survives the message being deleted.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1d989cd75d8'
down_revision: Union[str, None] = '0cd8f5c010c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('reporter_id', sa.Integer(), nullable=False),
        sa.Column('reported_id', sa.Integer(), nullable=False),
        sa.Column('room_id', sa.Integer(), nullable=True),
        sa.Column('message_id', sa.Integer(), nullable=True),
        sa.Column('reason', sa.String(length=20), nullable=False),
        sa.Column('details', sa.String(length=500), nullable=True),
        sa.Column('snapshot', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='open', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['reporter_id'], ['users.id']),
        sa.ForeignKeyConstraint(['reported_id'], ['users.id']),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_reports_reported_id'), 'reports', ['reported_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_reports_reported_id'), table_name='reports')
    op.drop_table('reports')
