import uuid
from datetime import datetime, timezone
from app.extensions import db


class UserProfile(db.Model):
    __tablename__ = 'user_profiles'

    id = db.Column(db.String(36), primary_key=True)  # Supabase auth.users UUID
    display_name = db.Column(db.String(100), nullable=False)
    avatar_url = db.Column(db.String(500), nullable=True)
    sort_preference = db.Column(db.String(20), default='lastread')
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    articles = db.relationship('Article', backref='user', lazy='dynamic')
    collections = db.relationship('Collection', backref='user', lazy='dynamic')
    history_entries = db.relationship('HistoryEntry', backref='user', lazy='dynamic')
