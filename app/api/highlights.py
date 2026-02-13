from flask import Blueprint, request, jsonify, g
from app.extensions import db
from app.models.article import Article
from app.models.highlight import Highlight
from app.middleware.auth import require_auth

bp = Blueprint('highlights', __name__, url_prefix='/api/articles')


def _highlight_to_dict(highlight):
    return {
        'id': highlight.id,
        'article_id': highlight.article_id,
        'start_xpath': highlight.start_xpath,
        'start_offset': highlight.start_offset,
        'end_xpath': highlight.end_xpath,
        'end_offset': highlight.end_offset,
        'selected_text': highlight.selected_text,
        'note': highlight.note,
        'color': highlight.color,
        'created_at': highlight.created_at.isoformat(),
    }


@bp.route('/<article_id>/highlights', methods=['GET'])
@require_auth
def list_highlights(article_id):
    """List all highlights for an article."""
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    highlights = Highlight.query.filter_by(
        article_id=article_id, user_id=g.user_id
    ).order_by(Highlight.created_at.asc()).all()

    return jsonify({'highlights': [_highlight_to_dict(h) for h in highlights]})


@bp.route('/<article_id>/highlights', methods=['POST'])
@require_auth
def create_highlight(article_id):
    """Create a highlight on an article."""
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    required = ['start_xpath', 'start_offset', 'end_xpath', 'end_offset', 'selected_text']
    for field in required:
        if field not in data:
            return jsonify({'error': f'{field} is required'}), 400

    highlight = Highlight(
        user_id=g.user_id,
        article_id=article_id,
        start_xpath=data['start_xpath'],
        start_offset=data['start_offset'],
        end_xpath=data['end_xpath'],
        end_offset=data['end_offset'],
        selected_text=data['selected_text'],
        note=data.get('note'),
        color=data.get('color', 'yellow'),
    )
    db.session.add(highlight)
    db.session.commit()

    return jsonify({'highlight': _highlight_to_dict(highlight)}), 201


@bp.route('/<article_id>/highlights/<highlight_id>', methods=['PATCH'])
@require_auth
def update_highlight(article_id, highlight_id):
    """Update a highlight's note or color."""
    highlight = Highlight.query.filter_by(
        id=highlight_id, article_id=article_id, user_id=g.user_id
    ).first()
    if not highlight:
        return jsonify({'error': 'Highlight not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    if 'note' in data:
        highlight.note = data['note']
    if 'color' in data:
        highlight.color = data['color']

    db.session.commit()

    return jsonify({'highlight': _highlight_to_dict(highlight)})


@bp.route('/<article_id>/highlights/<highlight_id>', methods=['DELETE'])
@require_auth
def delete_highlight(article_id, highlight_id):
    """Remove a highlight."""
    highlight = Highlight.query.filter_by(
        id=highlight_id, article_id=article_id, user_id=g.user_id
    ).first()
    if not highlight:
        return jsonify({'error': 'Highlight not found'}), 404

    db.session.delete(highlight)
    db.session.commit()

    return jsonify({'ok': True})
