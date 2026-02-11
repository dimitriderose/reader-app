"""Browser-based scraping for JS-heavy sites.

Provides a fallback chain beyond the standard requests + BeautifulSoup path:
  Layer 2: cloudscraper — Cloudflare JS challenge bypass (no browser needed)
  Layer 3: Playwright headless Chromium — full JS rendering with stealth

Both are optional dependencies. If not installed, the corresponding
functions return None and the caller falls back gracefully.
"""

import logging

logger = logging.getLogger(__name__)

# --- Graceful optional imports ---

try:
    import cloudscraper as _cloudscraper_mod
    CLOUDSCRAPER_AVAILABLE = True
except ImportError:
    CLOUDSCRAPER_AVAILABLE = False

try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False

try:
    from playwright_stealth import stealth_sync
    STEALTH_AVAILABLE = True
except ImportError:
    STEALTH_AVAILABLE = False


# Minimum word count — content below this is likely a JS shell, not real content
THIN_CONTENT_THRESHOLD = 50

_USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/120.0.0.0 Safari/537.36'
)


def fetch_with_cloudscraper(url: str, timeout: int = 20) -> str | None:
    """Fetch HTML using cloudscraper (Cloudflare JS challenge bypass).

    Returns raw HTML string, or None if unavailable or failed.
    """
    if not CLOUDSCRAPER_AVAILABLE:
        return None
    try:
        scraper = _cloudscraper_mod.create_scraper(
            browser={'browser': 'chrome', 'platform': 'windows'},
        )
        response = scraper.get(url, timeout=timeout)
        response.raise_for_status()
        return response.text
    except Exception as e:
        logger.warning('cloudscraper failed for %s: %s', url, e)
        return None


def fetch_with_playwright(url: str, timeout: int = 30000) -> str | None:
    """Render a page with headless Chromium via Playwright.

    Applies playwright-stealth if available to avoid headless detection.
    Blocks images/fonts to speed up loading.

    Args:
        url: Page URL
        timeout: Navigation timeout in milliseconds

    Returns:
        Fully rendered HTML, or None if unavailable or failed.
    """
    if not PLAYWRIGHT_AVAILABLE:
        return None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                user_agent=_USER_AGENT,
                viewport={'width': 1280, 'height': 800},
            )
            page = context.new_page()

            # Apply stealth patches if available
            if STEALTH_AVAILABLE:
                stealth_sync(page)

            # Block heavy resources we don't need for text extraction
            page.route(
                '**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,eot}',
                lambda route: route.abort(),
            )

            page.goto(url, wait_until='networkidle', timeout=timeout)

            # Brief extra wait for late-loading content
            page.wait_for_timeout(2000)

            html = page.content()
            browser.close()
            return html
    except Exception as e:
        logger.warning('Playwright failed for %s: %s', url, e)
        return None


def get_scraper_capabilities() -> dict:
    """Report which scraping backends are installed."""
    return {
        'cloudscraper': CLOUDSCRAPER_AVAILABLE,
        'playwright': PLAYWRIGHT_AVAILABLE,
        'playwright_stealth': STEALTH_AVAILABLE,
    }
