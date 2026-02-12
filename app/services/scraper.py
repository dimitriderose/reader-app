import logging
import re
from urllib.parse import urlparse, parse_qs, unquote

import requests
from bs4 import BeautifulSoup

from .word_count import count_words

logger = logging.getLogger(__name__)

_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept': (
        'text/html,application/xhtml+xml,application/xml;'
        'q=0.9,image/webp,*/*;q=0.8'
    ),
    'Accept-Language': 'en-US,en;q=0.9',
}


def _clean_url(url: str) -> str:
    """Unwrap browser reader-mode URLs to the real HTTP URL inside.

    Edge wraps URLs as: read://https_example.com/?url=<encoded_real_url>
    """
    if url.startswith('read://'):
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        if 'url' in qs:
            return unquote(qs['url'][0])
    return url


def extract_domain(url: str) -> str:
    """Extract domain from URL (e.g., 'nytimes.com')."""
    try:
        hostname = urlparse(url).hostname or ''
        return hostname.replace('www.', '')
    except Exception:
        return ''


_MSN_ARTICLE_RE = re.compile(r'msn\.com/([a-z]{2}-[a-z]{2})/.+/ar-([A-Za-z0-9]+)')


def _fetch_msn_article(url: str) -> dict | None:
    """Try MSN's content API for MSN article URLs.

    MSN is a React SPA whose HTML shell contains no article text.
    Their internal API returns the article body as JSON, which is
    much faster and more reliable than browser rendering.

    Returns a result dict, or None if not an MSN URL or API fails.
    """
    match = _MSN_ARTICLE_RE.search(url)
    if not match:
        return None
    locale, article_id = match.groups()
    api_url = f'https://assets.msn.com/content/view/v2/Detail/{locale}/{article_id}'
    try:
        resp = requests.get(api_url, headers=_HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        title = data.get('title', '')
        body_html = data.get('body', '')
        if not body_html:
            return None
        content_html, fallback_title = extract_text_and_nav_from_html(body_html)
        return {
            'title': title or fallback_title,
            'content_html': content_html,
            'word_count': count_words(content_html),
            'source_domain': extract_domain(url),
            'scrape_method': 'msn_api',
        }
    except Exception as e:
        logger.info('MSN API failed for %s: %s, falling back to default scraper', url, e)
        return None


def extract_text_and_nav_from_html(html: str) -> tuple:
    """Extract readable content from raw HTML.

    Ported from the original reader_app.py scraper logic.
    Strips scripts, styles, nav, sidebars, then finds the main content
    area and extracts cleaned text.

    Returns:
        tuple: (content_html, title)
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Extract title before cleaning
    title_tag = soup.find('title')
    title = title_tag.get_text(strip=True) if title_tag else ''

    # Remove script/style elements
    for script_or_style in soup(['script', 'style']):
        script_or_style.decompose()

    # Remove navigation and sidebar elements
    for nav in soup.find_all(['nav', 'aside']):
        nav.decompose()
    for leftbar in soup.find_all(
        class_=['sidebar', 'leftbar', 'left-nav', 'leftnavbar']
    ):
        leftbar.decompose()

    # Find main content area
    main = soup.find('main')
    if not main:
        article = soup.find('article')
        if article:
            main = article
        else:
            divs = soup.find_all('div')
            if divs:
                main = max(divs, key=lambda d: len(d.get_text()))
            else:
                main = soup

    # Get text content
    text = main.get_text(separator='\n') if main else soup.get_text(separator='\n')

    # Remove navigation text artifacts
    text = re.sub(r'\bPrevious\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\bNext\b', '', text, flags=re.IGNORECASE)

    # Clean up whitespace
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    text = '\n'.join(lines)

    # Build content HTML from cleaned text
    paragraphs = text.split('\n')
    content_html = ''.join(f'<p>{p}</p>' for p in paragraphs if p.strip())

    # If no title from <title> tag, use first line of content
    if not title and paragraphs:
        title = paragraphs[0][:200]

    return content_html, title


def fetch_and_parse(url: str) -> dict:
    """Fetch URL, extract readable content.

    Tries MSN content API first for MSN URLs (React SPA that returns
    empty HTML). Falls back to standard HTTP fetch for everything else.

    Returns:
        dict: { title, content_html, word_count, source_domain }
    """
    # Unwrap browser reader-mode URLs (e.g. Edge read:// protocol)
    url = _clean_url(url)

    # --- Fast path: MSN content API ---
    msn_result = _fetch_msn_article(url)
    if msn_result and msn_result.get('word_count', 0) > 0:
        return msn_result

    # --- Default: standard HTTP fetch ---
    response = requests.get(url, headers=_HEADERS, timeout=15)
    response.raise_for_status()

    content_html, title = extract_text_and_nav_from_html(response.text)
    word_count = count_words(content_html)
    source_domain = extract_domain(url)

    return {
        'title': title,
        'content_html': content_html,
        'word_count': word_count,
        'source_domain': source_domain,
    }
