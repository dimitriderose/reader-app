import uuid
from datetime import datetime, timezone
from app.extensions import db


class Article(db.Model):
    __tablename__ = 'articles'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    collection_id = db.Column(db.String(36), db.ForeignKey('collections.id', ondelete='SET NULL'), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    source_url = db.Column(db.String(2000), nullable=True)
    source_domain = db.Column(db.String(200), nullable=True)
    content_html = db.Column(db.Text, nullable=False)
    word_count = db.Column(db.Integer, default=0)
    current_page = db.Column(db.Integer, default=1)
    total_pages = db.Column(db.Integer, default=1)
    font_size = db.Column(db.Integer, default=20)
    font_family = db.Column(db.String(50), default='serif')
    theme = db.Column(db.String(10), default='light')
    line_height = db.Column(db.String(10), default='default')
    margin_width = db.Column(db.String(10), default='default')
    last_read_at = db.Column(db.DateTime, nullable=True)
    saved_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.Index('ix_articles_user_lastread', 'user_id', last_read_at.desc()),
        db.Index('ix_articles_user_saved', 'user_id', saved_at.desc()),
        db.Index('ix_articles_user_collection', 'user_id', 'collection_id'),
    )
