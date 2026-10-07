"""add consent records

Revision ID: c4d1e8f3a920
Revises: b7c3e9a2d514
Create Date: 2026-10-01T00:00:00.000000

One row per cookie/data choice a signed-in student makes (append-only), as a
record of what they consented to and when.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d1e8f3a920'
down_revision: Union[str, None] = 'b7c3e9a2d514'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'consent_records',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('policy_version', sa.String(length=20), nullable=False),
        sa.Column('preferences', sa.Boolean(), nullable=False),
        sa.Column('diagnostics', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_consent_records_user_id'), 'consent_records', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_consent_records_user_id'), table_name='consent_records')
    op.drop_table('consent_records')
