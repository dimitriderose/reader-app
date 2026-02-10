import uuid
from datetime import datetime, timezone
from app.extensions import db


class HistoryEntry(db.Model):
    __tablename__ = 'history_entries'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    article_id = db.Column(db.String(36), db.ForeignKey('articles.id', ondelete='SET NULL'), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    source_url = db.Column(db.String(2000), nullable=True)
    source_domain = db.Column(db.String(200), nullable=True)
    content_html = db.Column(db.Text, nullable=False)
    current_page = db.Column(db.Integer, default=1)
    total_pages = db.Column(db.Integer, default=1)
    content_hash = db.Column(db.String(64), nullable=False)
    opened_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint('user_id', 'content_hash', name='uq_user_content_hash'),
    )
