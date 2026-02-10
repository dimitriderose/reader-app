from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import Blueprint, request, jsonify, g
from app.extensions import db
from app.models.history import HistoryEntry
from app.middleware.auth import require_auth

bp = Blueprint('history', __name__, url_prefix='/api/history')


def _entry_to_dict(entry, include_content=False):
    """Serialize a HistoryEntry to a dict."""
    data = {
        'id': entry.id,
        'title': entry.title,
        'source_url': entry.source_url,
        'source_domain': entry.source_domain,
        'current_page': entry.current_page,
        'total_pages': entry.total_pages,
        'article_id': entry.article_id,
        'opened_at': entry.opened_at.isoformat() if entry.opened_at else None,
    }
    if include_content:
        data['content_html'] = entry.content_html
        data['content_hash'] = entry.content_hash
    return data


@bp.route('', methods=['GET'])
@require_auth
def list_history():
    """List history entries (NO content_html). Ordered by opened_at DESC."""
    entries = (
        HistoryEntry.query
        .filter_by(user_id=g.user_id)
        .order_by(HistoryEntry.opened_at.desc())
        .all()
    )
    return jsonify({'entries': [_entry_to_dict(e) for e in entries]})


@bp.route('/<entry_id>', methods=['GET'])
@require_auth
def get_history_entry(entry_id):
    """Get a single history entry WITH content_html."""
    entry = HistoryEntry.query.filter_by(
        id=entry_id, user_id=g.user_id
    ).first()
    if not entry:
        return jsonify({'error': 'History entry not found'}), 404

    return jsonify({'entry': _entry_to_dict(entry, include_content=True)})


@bp.route('', methods=['POST'])
@require_auth
def upsert_history():
    """UPSERT on (user_id, content_hash).

    If an entry with the same content_hash exists for this user,
    update opened_at + current_page + total_pages.
    Otherwise, create a new entry.
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    content_hash = data.get('content_hash')
    if not content_hash:
        return jsonify({'error': 'content_hash is required'}), 400

    title = data.get('title')
    content_html = data.get('content_html')
    if not title or not content_html:
        return jsonify({'error': 'title and content_html are required'}), 400

    source_url = data.get('source_url')
    source_domain = None
    if source_url:
        try:
            hostname = urlparse(source_url).hostname or ''
            source_domain = hostname.replace('www.', '')
        except Exception:
            source_domain = None

    # Check for existing entry with same content_hash
    existing = HistoryEntry.query.filter_by(
        user_id=g.user_id, content_hash=content_hash
    ).first()

    if existing:
        # Update existing entry
        existing.opened_at = datetime.now(timezone.utc)
        existing.current_page = data.get('current_page', existing.current_page)
        existing.total_pages = data.get('total_pages', existing.total_pages)
        existing.title = title
        existing.source_url = source_url
        existing.source_domain = source_domain
        db.session.commit()
        return jsonify({'entry': _entry_to_dict(existing, include_content=True)})
    else:
        # Create new entry
        entry = HistoryEntry(
            user_id=g.user_id,
            title=title,
            source_url=source_url,
            source_domain=source_domain,
            content_html=content_html,
            content_hash=content_hash,
            current_page=data.get('current_page', 1),
            total_pages=data.get('total_pages', 1),
            article_id=data.get('article_id'),
        )
        db.session.add(entry)
        db.session.commit()
        return jsonify({'entry': _entry_to_dict(entry, include_content=True)}), 201


@bp.route('/<entry_id>/position', methods=['PATCH'])
@require_auth
def update_history_position(entry_id):
    """Update reading position for a history entry."""
    entry = HistoryEntry.query.filter_by(
        id=entry_id, user_id=g.user_id
    ).first()
    if not entry:
        return jsonify({'error': 'History entry not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    if 'current_page' in data:
        entry.current_page = data['current_page']
    if 'total_pages' in data:
        entry.total_pages = data['total_pages']

    db.session.commit()

    return jsonify({'ok': True})


@bp.route('/clear', methods=['DELETE'])
@require_auth
def clear_history():
    """Clear ALL history for the authenticated user.

    Must be registered before /<entry_id> so Flask matches
    the static '/clear' path before the variable rule.
    """
    HistoryEntry.query.filter_by(user_id=g.user_id).delete()
    db.session.commit()

    return jsonify({'ok': True})


@bp.route('/<entry_id>', methods=['DELETE'])
@require_auth
def delete_history_entry(entry_id):
    """Remove a single history entry."""
    entry = HistoryEntry.query.filter_by(
        id=entry_id, user_id=g.user_id
    ).first()
    if not entry:
        return jsonify({'error': 'History entry not found'}), 404

    db.session.delete(entry)
    db.session.commit()

    return jsonify({'ok': True})
