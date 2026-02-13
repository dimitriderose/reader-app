from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import Blueprint, request, jsonify, g
from app.extensions import db
from app.models.article import Article
from app.middleware.auth import require_auth
from app.services.word_count import count_words

bp = Blueprint('articles', __name__, url_prefix='/api/articles')


def _article_to_dict(article, include_content=False):
    """Serialize an Article to a dict."""
    data = {
        'id': article.id,
        'title': article.title,
        'source_url': article.source_url,
        'source_domain': article.source_domain,
        'word_count': article.word_count,
        'current_page': article.current_page,
        'total_pages': article.total_pages,
        'font_size': article.font_size,
        'font_family': article.font_family,
        'theme': article.theme,
        'line_height': article.line_height,
        'margin_width': article.margin_width,
        'collection_id': article.collection_id,
        'last_read_at': article.last_read_at.isoformat() if article.last_read_at else None,
        'saved_at': article.saved_at.isoformat() if article.saved_at else None,
    }
    if include_content:
        data['content_html'] = article.content_html
    return data


@bp.route('', methods=['GET'])
@require_auth
def list_articles():
    """List library articles (NO content_html in response).

    Query params:
        sort: lastread|saved|progress (default: lastread)
        collection_id: <uuid> or 'uncategorized'
    """
    sort = request.args.get('sort', 'lastread')
    collection_id = request.args.get('collection_id')

    query = Article.query.filter_by(user_id=g.user_id)

    # Filter by collection
    if collection_id == 'uncategorized':
        query = query.filter(Article.collection_id.is_(None))
    elif collection_id:
        query = query.filter_by(collection_id=collection_id)

    # Sort
    if sort == 'saved':
        query = query.order_by(Article.saved_at.desc())
    elif sort == 'progress':
        # Sort by progress ratio ascending (least progress first)
        query = query.order_by(
            (Article.current_page * 1.0 / Article.total_pages).asc()
        )
    else:
        # Default: lastread
        query = query.order_by(Article.last_read_at.desc().nullslast())

    articles = query.all()
    return jsonify({'articles': [_article_to_dict(a) for a in articles]})


@bp.route('', methods=['POST'])
@require_auth
def save_article():
    """Save an article to the library.

    Server computes word_count from content_html.
    Extracts source_domain from source_url.
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

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

    # Server computes word_count from content_html
    word_count = count_words(content_html)

    article = Article(
        user_id=g.user_id,
        title=title,
        source_url=source_url,
        source_domain=source_domain,
        content_html=content_html,
        word_count=word_count,
        current_page=data.get('current_page', 1),
        total_pages=data.get('total_pages', 1),
        font_size=data.get('font_size', 20),
        font_family=data.get('font_family', 'serif'),
        theme=data.get('theme', 'light'),
        line_height=data.get('line_height', 'default'),
        margin_width=data.get('margin_width', 'default'),
        collection_id=data.get('collection_id'),
    )
    db.session.add(article)
    db.session.commit()

    return jsonify({'article': _article_to_dict(article, include_content=True)}), 201


@bp.route('/<article_id>', methods=['GET'])
@require_auth
def get_article(article_id):
    """Get a single article WITH content_html. Only if user owns it."""
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    return jsonify({'article': _article_to_dict(article, include_content=True)})


@bp.route('/<article_id>', methods=['PATCH'])
@require_auth
def update_article(article_id):
    """Update article metadata. Updates last_read_at."""
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    if 'collection_id' in data:
        article.collection_id = data['collection_id']
    if 'font_size' in data:
        article.font_size = data['font_size']
    if 'font_family' in data:
        article.font_family = data['font_family']
    if 'theme' in data:
        article.theme = data['theme']
    if 'line_height' in data:
        article.line_height = data['line_height']
    if 'margin_width' in data:
        article.margin_width = data['margin_width']

    article.last_read_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify({'article': _article_to_dict(article, include_content=True)})


@bp.route('/<article_id>/position', methods=['PATCH'])
@require_auth
def update_position(article_id):
    """Auto-save reading position.

    Handles sendBeacon: Content-Type may be text/plain, so parse JSON
    from request.data if needed.
    """
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    # Handle both JSON and sendBeacon (Content-Type may not be application/json)
    if request.content_type and 'json' in request.content_type:
        data = request.get_json()
    else:
        data = request.get_json(force=True, silent=True) or {}

    if 'current_page' in data:
        article.current_page = data['current_page']
    if 'total_pages' in data:
        article.total_pages = data['total_pages']

    article.last_read_at = datetime.now(timezone.utc)
    db.session.commit()

    return jsonify({'ok': True})


@bp.route('/<article_id>', methods=['DELETE'])
@require_auth
def delete_article(article_id):
    """Remove an article from the library."""
    article = Article.query.filter_by(id=article_id, user_id=g.user_id).first()
    if not article:
        return jsonify({'error': 'Article not found'}), 404

    db.session.delete(article)
    db.session.commit()

    return jsonify({'ok': True})
