from flask import Blueprint, request, jsonify
from app.middleware.auth import optional_auth
from app.services.scraper import fetch_and_parse, ScrapeError
from app.services.browser_scraper import get_scraper_capabilities

bp = Blueprint('fetch', __name__, url_prefix='/api')


@bp.route('/fetch', methods=['POST'])
@optional_auth
def fetch_url():
    """Fetch and parse a URL with JS rendering fallback.

    Accepts: { url }
    Returns: { title, content_html, word_count, source_domain, scrape_method }
    Returns 422 if fetch fails with categorized error.
    """
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400

    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'URL is required'}), 400

    try:
        result = fetch_and_parse(url)
        if not result.get('content_html', '').strip():
            caps = get_scraper_capabilities()
            hint = (
                'This site may require JavaScript rendering. '
                'Browser engine is not installed.'
                if not caps.get('playwright')
                else 'The page loaded but no readable content was found.'
            )
            return jsonify({
                'error': 'Could not extract content from this page.',
                'error_code': 'EMPTY_CONTENT',
                'hint': hint,
                'scrape_method': result.get('scrape_method'),
            }), 422
        return jsonify(result)

    except ScrapeError as e:
        return jsonify({
            'error': _categorize_error(e),
            'error_code': 'SCRAPE_FAILED',
            'hint': _build_hint(e),
            'capabilities': e.capabilities,
        }), 422

    except Exception as e:
        return jsonify({
            'error': str(e),
            'error_code': 'UNKNOWN_ERROR',
        }), 422


@bp.route('/fetch/capabilities', methods=['GET'])
@optional_auth
def scraper_capabilities():
    """Report which scraping backends are available."""
    return jsonify(get_scraper_capabilities())


def _categorize_error(e: ScrapeError) -> str:
    detail = e.detail.lower()
    if '403' in detail or 'forbidden' in detail:
        return 'This site blocks automated access.'
    if 'timeout' in detail:
        return 'The site took too long to respond.'
    if 'cloudflare' in detail:
        return 'This site uses advanced bot protection.'
    return f'Could not fetch this page: {e.detail}'


def _build_hint(e: ScrapeError) -> str:
    if not e.capabilities.get('playwright'):
        return ('Install Playwright for JavaScript rendering support: '
                'pip install playwright && playwright install chromium')
    if not e.capabilities.get('cloudscraper'):
        return 'Install cloudscraper for Cloudflare bypass: pip install cloudscraper'
    return 'All scraping methods were attempted. This site may actively block automated access.'
