from flask import Blueprint, request, jsonify, g
from sqlalchemy import func
from app.extensions import db
from app.models.collection import Collection
from app.models.article import Article
from app.middleware.auth import require_auth

bp = Blueprint('collections', __name__, url_prefix='/api/collections')


def _collection_to_dict(collection, article_count=None):
    """Serialize a Collection to a dict."""
    data = {
        'id': collection.id,
        'name': collection.name,
        'color': collection.color,
        'position': collection.position,
        'created_at': collection.created_at.isoformat() if collection.created_at else None,
    }
    if article_count is not None:
        data['article_count'] = article_count
    return data


@bp.route('', methods=['GET'])
@require_auth
def list_collections():
    """List collections with article counts (using subquery)."""
    # Subquery to count articles per collection
    article_count_subq = (
        db.session.query(
            Article.collection_id,
            func.count(Article.id).label('article_count')
        )
        .filter(Article.user_id == g.user_id)
        .group_by(Article.collection_id)
        .subquery()
    )

    results = (
        db.session.query(Collection, article_count_subq.c.article_count)
        .outerjoin(
            article_count_subq,
            Collection.id == article_count_subq.c.collection_id
        )
        .filter(Collection.user_id == g.user_id)
        .order_by(Collection.position.asc())
        .all()
    )

    collections = []
    for collection, count in results:
        collections.append(_collection_to_dict(collection, article_count=count or 0))

    return jsonify({'collections': collections})


@bp.route('', methods=['POST'])
@require_auth
def create_collection():
    """Create a new collection. Check UNIQUE(user_id, name)."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    name = data.get('name')
    if not name:
        return jsonify({'error': 'name is required'}), 400

    # Check uniqueness
    existing = Collection.query.filter_by(user_id=g.user_id, name=name).first()
    if existing:
        return jsonify({'error': 'A collection with this name already exists'}), 400

    collection = Collection(
        user_id=g.user_id,
        name=name,
        color=data.get('color', 'blue'),
    )
    db.session.add(collection)
    db.session.commit()

    return jsonify({'collection': _collection_to_dict(collection)}), 201


@bp.route('/<collection_id>', methods=['PATCH'])
@require_auth
def update_collection(collection_id):
    """Update collection name, color, or position."""
    collection = Collection.query.filter_by(
        id=collection_id, user_id=g.user_id
    ).first()
    if not collection:
        return jsonify({'error': 'Collection not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    if 'name' in data:
        # Check uniqueness if name is changing
        if data['name'] != collection.name:
            existing = Collection.query.filter_by(
                user_id=g.user_id, name=data['name']
            ).first()
            if existing:
                return jsonify({'error': 'A collection with this name already exists'}), 400
        collection.name = data['name']
    if 'color' in data:
        collection.color = data['color']
    if 'position' in data:
        collection.position = data['position']

    db.session.commit()

    return jsonify({'collection': _collection_to_dict(collection)})


@bp.route('/<collection_id>', methods=['DELETE'])
@require_auth
def delete_collection(collection_id):
    """Delete a collection.

    Articles with this collection_id become NULL (uncategorized).
    ON DELETE SET NULL handles this via the foreign key in the Article model,
    but we explicitly set them here for clarity and SQLite compatibility.
    """
    collection = Collection.query.filter_by(
        id=collection_id, user_id=g.user_id
    ).first()
    if not collection:
        return jsonify({'error': 'Collection not found'}), 404

    # Set articles in this collection to uncategorized
    Article.query.filter_by(collection_id=collection_id).update(
        {'collection_id': None}
    )

    db.session.delete(collection)
    db.session.commit()

    return jsonify({'ok': True})
