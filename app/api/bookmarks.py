from flask import Blueprint, request, jsonify, g
from app.extensions import db
from app.models.article import Article
from app.models.bookmark import Bookmark
from app.middleware.auth import require_auth

bp = Blueprint('bookmarks', __name__, url_prefix='/api/articles')


def _bookmark_to_dict(bookmark):
    return {
        'id': bookmark.id,
        'article_id': bookmark.article_id,
        'page_number': bookmark.page_number,
        'label': bookmark.label,
        'created_at': bookmark.created_at.isoformat(),
    }


@bp.route('/<article_id>/bookmarks', methods=['GET'])
@require_auth
def list_bookmarks(article_id):
    """List all bookmarks for an article."""
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    bookmarks = Bookmark.query.filter_by(
        article_id=article_id, user_id=g.user_id
    ).order_by(Bookmark.page_number.asc()).all()

    return jsonify({'bookmarks': [_bookmark_to_dict(b) for b in bookmarks]})


@bp.route('/<article_id>/bookmarks', methods=['POST'])
@require_auth
def create_bookmark(article_id):
    """Add a bookmark to an article page."""
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    data = request.get_json()
    if not data or 'page_number' not in data:
        return jsonify({'error': 'page_number is required'}), 400

    page_number = data['page_number']

    # Check if bookmark already exists for this page
    existing = Bookmark.query.filter_by(
        article_id=article_id, page_number=page_number
    ).first()
    if existing:
        return jsonify({'bookmark': _bookmark_to_dict(existing)}), 200

    bookmark = Bookmark(
        user_id=g.user_id,
        article_id=article_id,
        page_number=page_number,
        label=data.get('label'),
    )
    db.session.add(bookmark)
    db.session.commit()

    return jsonify({'bookmark': _bookmark_to_dict(bookmark)}), 201


@bp.route('/<article_id>/bookmarks/<bookmark_id>', methods=['DELETE'])
@require_auth
def delete_bookmark(article_id, bookmark_id):
    """Remove a bookmark."""
    bookmark = Bookmark.query.filter_by(
        id=bookmark_id, article_id=article_id, user_id=g.user_id
    ).first()
    if not bookmark:
        return jsonify({'error': 'Bookmark not found'}), 404

    db.session.delete(bookmark)
    db.session.commit()

    return jsonify({'ok': True})
