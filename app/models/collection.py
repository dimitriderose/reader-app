import uuid
from datetime import datetime, timezone
from app.extensions import db


class Collection(db.Model):
    __tablename__ = 'collections'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    color = db.Column(db.String(20), default='blue')
    position = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    articles = db.relationship('Article', backref='collection', lazy='dynamic')

    __table_args__ = (
        db.UniqueConstraint('user_id', 'name', name='uq_user_collection_name'),
    )
