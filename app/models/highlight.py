import uuid
from datetime import datetime, timezone
from app.extensions import db


class Highlight(db.Model):
    __tablename__ = 'highlights'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    article_id = db.Column(db.String(36), db.ForeignKey('articles.id', ondelete='CASCADE'), nullable=False)
    start_xpath = db.Column(db.String(500), nullable=False)
    start_offset = db.Column(db.Integer, nullable=False)
    end_xpath = db.Column(db.String(500), nullable=False)
    end_offset = db.Column(db.Integer, nullable=False)
    selected_text = db.Column(db.Text, nullable=False)
    note = db.Column(db.Text, nullable=True)
    color = db.Column(db.String(20), default='yellow')
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.Index('ix_highlights_article', 'article_id'),
    )
