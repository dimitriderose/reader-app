from flask import Blueprint, request, jsonify
from app.middleware.auth import optional_auth
from app.services.scraper import fetch_and_parse

bp = Blueprint('fetch', __name__, url_prefix='/api')


@bp.route('/fetch', methods=['POST'])
@optional_auth
def fetch_url():
    """Fetch and parse a URL. Works for logged-out users too (optional_auth).

    Accepts: { url }
    Returns: { title, content_html, word_count, source_domain }
    Returns 422 if fetch fails.
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'URL is required'}), 400

    try:
        result = fetch_and_parse(url)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 422
