import uuid
from datetime import datetime, timezone
from app.extensions import db


class Bookmark(db.Model):
    __tablename__ = 'bookmarks'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    article_id = db.Column(db.String(36), db.ForeignKey('articles.id', ondelete='CASCADE'), nullable=False)
    page_number = db.Column(db.Integer, nullable=False)
    label = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint('article_id', 'page_number', name='uq_bookmark_article_page'),
        db.Index('ix_bookmarks_article', 'article_id'),
    )
