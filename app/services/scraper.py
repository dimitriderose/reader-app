"""Web scraper with 3-layer fallback chain.

Layer 1: requests        — fast, works for static HTML
Layer 2: cloudscraper    — Cloudflare JS challenge bypass (no browser)
Layer 3: Playwright      — full headless Chromium JS rendering + stealth

Each layer produces raw HTML which is parsed by the shared
extract_text_and_nav_from_html() function.
"""

import logging
import re
import time
from urllib.parse import urlparse, parse_qs, unquote

import requests
from bs4 import BeautifulSoup

from .word_count import count_words
from .browser_scraper import (
    fetch_with_cloudscraper,
    fetch_with_playwright,
    THIN_CONTENT_THRESHOLD,
    CLOUDSCRAPER_AVAILABLE,
    PLAYWRIGHT_AVAILABLE,
    get_scraper_capabilities,
)

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

# ---------------------------------------------------------------------------
# Content cache (same pattern as news_feed.py)
# ---------------------------------------------------------------------------

_scrape_cache = {}
_CACHE_TTL = 300  # 5 minutes

def _get_cached(url):
    if url in _scrape_cache:
        ts, data = _scrape_cache[url]
        if time.time() - ts < _CACHE_TTL:
            return data
    return None

def _set_cached(url, data):
    _scrape_cache[url] = (time.time(), data)
    if len(_scrape_cache) > 200:
        oldest = min(_scrape_cache, key=lambda k: _scrape_cache[k][0])
        del _scrape_cache[oldest]


# ---------------------------------------------------------------------------
# Custom error
# ---------------------------------------------------------------------------

class ScrapeError(Exception):
    """Structured error with scraping context for better user messages."""

    def __init__(self, url, detail, capabilities=None):
        self.url = url
        self.detail = detail
        self.capabilities = capabilities or {}
        super().__init__(detail)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
        content_html, fallback_title, lang = extract_text_and_nav_from_html(body_html)
        return _build_result(title or fallback_title, content_html, url, 'msn_api', lang)
    except Exception as e:
        logger.info('MSN API failed for %s: %s, falling back to scraper chain', url, e)
        return None


def extract_text_and_nav_from_html(html: str) -> tuple:
    """Extract readable content from raw HTML.

    Strips scripts, styles, nav, sidebars, then finds the main content
    area and extracts cleaned text.

    Returns:
        tuple: (content_html, title, lang)
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Extract title before cleaning
    title_tag = soup.find('title')
    title = title_tag.get_text(strip=True) if title_tag else ''

    # Extract lang attribute from <html> tag
    html_tag = soup.find('html')
    lang = html_tag.get('lang', '') if html_tag else ''

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

    return content_html, title, lang


def _is_thin_content(content_html: str) -> bool:
    """Check if extracted content is too sparse to be a real article."""
    return count_words(content_html) < THIN_CONTENT_THRESHOLD


def _is_cloudflare_challenge(html: str) -> bool:
    """Detect Cloudflare challenge/interstitial pages."""
    indicators = [
        'cf-browser-verification',
        'challenge-platform',
        'Just a moment...',
        'Checking your browser',
        'cf_chl_opt',
    ]
    return any(indicator in html for indicator in indicators)


def _build_result(title, content_html, url, method, lang=''):
    result = {
        'title': title,
        'content_html': content_html,
        'word_count': count_words(content_html),
        'source_domain': extract_domain(url),
        'scrape_method': method,
    }
    if lang:
        result['lang'] = lang
    return result


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def fetch_and_parse(url: str) -> dict:
    """Fetch a URL with fallback chain, extract readable content.

    Chain: MSN API (if applicable) → requests → cloudscraper → Playwright

    Returns:
        dict with: title, content_html, word_count, source_domain, scrape_method
    """
    # Unwrap browser reader-mode URLs (e.g. Edge read:// protocol)
    url = _clean_url(url)

    # Check cache
    cached = _get_cached(url)
    if cached is not None:
        return cached

    # --- Fast path: MSN content API (avoids 30s Playwright timeout) ---
    msn_result = _fetch_msn_article(url)
    if msn_result and not _is_thin_content(msn_result['content_html']):
        _set_cached(url, msn_result)
        return msn_result

    last_html = None
    last_method = 'requests'
    needs_escalation = False
    error_detail = None

    # --- Layer 1: requests (always tried first) ---
    try:
        response = requests.get(url, headers=_HEADERS, timeout=15)
        raw_html = response.text

        if _is_cloudflare_challenge(raw_html):
            logger.info('Cloudflare challenge for %s, escalating', url)
            last_html = raw_html
            needs_escalation = True
        elif response.status_code >= 400:
            # Error status, but the body might still have extractable content
            logger.info(
                'HTTP %d for %s, checking body before escalating',
                response.status_code, url,
            )
            last_html = raw_html
            needs_escalation = True
        else:
            content_html, title, lang = extract_text_and_nav_from_html(raw_html)
            if not _is_thin_content(content_html):
                result = _build_result(title, content_html, url, 'requests', lang)
                _set_cached(url, result)
                return result
            else:
                logger.info(
                    'Thin content from requests for %s (%d words), escalating',
                    url, count_words(content_html),
                )
                last_html = raw_html
                needs_escalation = True
    except requests.RequestException as e:
        logger.info('requests failed for %s: %s, escalating', url, e)
        error_detail = str(e)
        needs_escalation = True

    # --- Layer 2: cloudscraper (only if layer 1 failed or returned bad content) ---
    if needs_escalation and CLOUDSCRAPER_AVAILABLE:
        raw_html = fetch_with_cloudscraper(url)
        if raw_html:
            content_html, title, lang = extract_text_and_nav_from_html(raw_html)
            if not _is_thin_content(content_html):
                result = _build_result(title, content_html, url, 'cloudscraper', lang)
                _set_cached(url, result)
                return result
            else:
                logger.info('Thin content from cloudscraper for %s, escalating', url)
                last_html = raw_html
                last_method = 'cloudscraper'

    # --- Layer 3: Playwright (only if prior layers failed or returned bad content) ---
    if needs_escalation and PLAYWRIGHT_AVAILABLE:
        raw_html = fetch_with_playwright(url)
        if raw_html:
            content_html, title, lang = extract_text_and_nav_from_html(raw_html)
            if not _is_thin_content(content_html):
                result = _build_result(title, content_html, url, 'playwright', lang)
                _set_cached(url, result)
                return result
            else:
                logger.info('Thin content from Playwright for %s, using best effort', url)
                last_html = raw_html
                last_method = 'playwright'

    # --- Best effort: return whatever we got, even if thin ---
    if last_html is not None:
        content_html, title, lang = extract_text_and_nav_from_html(last_html)
        result = _build_result(title, content_html, url, last_method, lang)
        _set_cached(url, result)
        return result

    # --- Complete failure ---
    raise ScrapeError(
        url=url,
        detail=error_detail or 'All scraping methods failed',
        capabilities=get_scraper_capabilities(),
    )
