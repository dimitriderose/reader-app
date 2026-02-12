"""Tests for the enhanced scraper with 3-layer fallback chain."""

from unittest.mock import patch, MagicMock

import pytest

from app.services.scraper import (
    fetch_and_parse,
    extract_text_and_nav_from_html,
    _is_thin_content,
    _is_cloudflare_challenge,
    _build_result,
    _scrape_cache,
    ScrapeError,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_article_html(word_count=100, title='Test Article'):
    """Generate HTML with a known word count."""
    words = ' '.join(['word'] * word_count)
    return (
        f'<html><head><title>{title}</title></head>'
        f'<body><article><p>{words}</p></article></body></html>'
    )


def _make_thin_html():
    """Generate HTML with almost no content (like a JS SPA shell)."""
    return '<html><head><title>App</title></head><body><div id="root"></div></body></html>'


def _cloudflare_html():
    return (
        '<html><head><title>Just a moment...</title></head>'
        '<body>cf-browser-verification challenge-platform</body></html>'
    )


@pytest.fixture(autouse=True)
def clear_cache():
    """Clear the scrape cache between tests."""
    _scrape_cache.clear()
    yield
    _scrape_cache.clear()


# ---------------------------------------------------------------------------
# _is_thin_content
# ---------------------------------------------------------------------------

class TestThinContentDetection:
    def test_empty_html_is_thin(self):
        assert _is_thin_content('') is True

    def test_few_words_is_thin(self):
        assert _is_thin_content('<p>Hello world</p>') is True

    def test_exactly_threshold_not_thin(self):
        words = ' '.join(['word'] * 50)
        assert _is_thin_content(f'<p>{words}</p>') is False

    def test_real_article_not_thin(self):
        words = ' '.join(['word'] * 200)
        assert _is_thin_content(f'<p>{words}</p>') is False


# ---------------------------------------------------------------------------
# _is_cloudflare_challenge
# ---------------------------------------------------------------------------

class TestCloudflareDetection:
    def test_detects_cf_browser_verification(self):
        assert _is_cloudflare_challenge('<div class="cf-browser-verification">') is True

    def test_detects_just_a_moment(self):
        assert _is_cloudflare_challenge('<title>Just a moment...</title>') is True

    def test_detects_challenge_platform(self):
        assert _is_cloudflare_challenge('challenge-platform data-cid') is True

    def test_detects_cf_chl_opt(self):
        assert _is_cloudflare_challenge('window.cf_chl_opt = {};') is True

    def test_normal_page_not_detected(self):
        assert _is_cloudflare_challenge('<html><body><p>Real content</p></body></html>') is False

    def test_empty_not_detected(self):
        assert _is_cloudflare_challenge('') is False


# ---------------------------------------------------------------------------
# extract_text_and_nav_from_html
# ---------------------------------------------------------------------------

class TestExtractContent:
    def test_extracts_title(self):
        html = '<html><head><title>My Title</title></head><body><p>Text</p></body></html>'
        content, title = extract_text_and_nav_from_html(html)
        assert title == 'My Title'

    def test_extracts_article_content(self):
        html = '<html><body><article><p>Article text here</p></article></body></html>'
        content, _ = extract_text_and_nav_from_html(html)
        assert 'Article text here' in content

    def test_strips_scripts(self):
        html = '<html><body><script>alert("x")</script><p>Real content</p></body></html>'
        content, _ = extract_text_and_nav_from_html(html)
        assert 'alert' not in content
        assert 'Real content' in content

    def test_strips_nav_elements(self):
        html = '<html><body><nav>Navigation</nav><p>Real content</p></body></html>'
        content, _ = extract_text_and_nav_from_html(html)
        assert 'Navigation' not in content
        assert 'Real content' in content

    def test_fallback_title_from_content(self):
        html = '<html><body><p>First paragraph</p></body></html>'
        _, title = extract_text_and_nav_from_html(html)
        assert title == 'First paragraph'


# ---------------------------------------------------------------------------
# _build_result
# ---------------------------------------------------------------------------

class TestBuildResult:
    def test_includes_all_fields(self):
        result = _build_result('Title', '<p>some content here</p>', 'https://example.com/article', 'requests')
        assert result['title'] == 'Title'
        assert result['content_html'] == '<p>some content here</p>'
        assert result['word_count'] == 3
        assert result['source_domain'] == 'example.com'
        assert result['scrape_method'] == 'requests'


# ---------------------------------------------------------------------------
# ScrapeError
# ---------------------------------------------------------------------------

class TestScrapeError:
    def test_attributes(self):
        err = ScrapeError(url='https://x.com', detail='403 Forbidden', capabilities={'playwright': True})
        assert err.url == 'https://x.com'
        assert err.detail == '403 Forbidden'
        assert err.capabilities == {'playwright': True}
        assert str(err) == '403 Forbidden'


# ---------------------------------------------------------------------------
# fetch_and_parse — fallback chain
# ---------------------------------------------------------------------------

class TestFallbackChain:

    @patch('app.services.scraper.requests.get')
    def test_requests_success_returns_immediately(self, mock_get):
        """When requests returns good content, no fallback is needed."""
        mock_resp = MagicMock()
        mock_resp.text = _make_article_html(100, 'Good Article')
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        result = fetch_and_parse('https://example.com/article')

        assert result['scrape_method'] == 'requests'
        assert result['word_count'] >= 50
        assert result['title'] == 'Good Article'
        assert result['source_domain'] == 'example.com'

    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False)
    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', False)
    @patch('app.services.scraper.requests.get')
    def test_thin_content_no_fallbacks_returns_best_effort(self, mock_get):
        """Thin content with no fallbacks available still returns what we have."""
        mock_resp = MagicMock()
        mock_resp.text = _make_thin_html()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        result = fetch_and_parse('https://example.com/spa')

        assert result['scrape_method'] == 'requests'
        assert result['word_count'] < 50  # thin but returned

    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False)
    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', False)
    @patch('app.services.scraper.requests.get')
    def test_requests_failure_raises_scrape_error(self, mock_get):
        """When requests fails and no fallbacks, raises ScrapeError."""
        import requests as req_lib
        mock_get.side_effect = req_lib.ConnectionError('Connection refused')

        with pytest.raises(ScrapeError) as exc_info:
            fetch_and_parse('https://example.com/down')

        assert 'Connection refused' in exc_info.value.detail

    @patch('app.services.scraper.fetch_with_cloudscraper')
    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', True)
    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False)
    @patch('app.services.scraper.requests.get')
    def test_thin_content_escalates_to_cloudscraper(self, mock_get, mock_cs):
        """Thin content from requests triggers cloudscraper fallback."""
        # requests returns thin content
        mock_resp = MagicMock()
        mock_resp.text = _make_thin_html()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        # cloudscraper returns good content
        mock_cs.return_value = _make_article_html(100, 'CS Article')

        result = fetch_and_parse('https://example.com/js-site')

        assert result['scrape_method'] == 'cloudscraper'
        assert result['word_count'] >= 50

    @patch('app.services.scraper.fetch_with_playwright')
    @patch('app.services.scraper.fetch_with_cloudscraper')
    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', True)
    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', True)
    @patch('app.services.scraper.requests.get')
    def test_full_chain_to_playwright(self, mock_get, mock_cs, mock_pw):
        """All layers thin → falls through to Playwright."""
        # requests: thin
        mock_resp = MagicMock()
        mock_resp.text = _make_thin_html()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        # cloudscraper: also thin
        mock_cs.return_value = _make_thin_html()

        # Playwright: good content
        mock_pw.return_value = _make_article_html(150, 'PW Article')

        result = fetch_and_parse('https://example.com/heavy-js')

        assert result['scrape_method'] == 'playwright'
        assert result['word_count'] >= 50

    @patch('app.services.scraper.requests.get')
    def test_cloudflare_detected_escalates(self, mock_get):
        """Cloudflare challenge page triggers escalation, returns best-effort if no fallbacks."""
        mock_resp = MagicMock()
        mock_resp.text = _cloudflare_html()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        with patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', False), \
             patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False):
            # CF page is stored as last_html, returned as best-effort
            result = fetch_and_parse('https://protected-site.com/article')
            assert result['scrape_method'] == 'requests'

    @patch('app.services.scraper.fetch_with_cloudscraper')
    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', True)
    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False)
    @patch('app.services.scraper.requests.get')
    def test_requests_always_tried_first_even_for_js_sites(self, mock_get, mock_cs):
        """Requests is always attempted first; escalation is signal-driven."""
        # requests returns thin content (JS shell)
        mock_resp = MagicMock()
        mock_resp.text = _make_thin_html()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        # cloudscraper returns good content
        mock_cs.return_value = _make_article_html(100, 'TMZ Story')

        result = fetch_and_parse('https://www.tmz.com/article')

        mock_get.assert_called_once()  # requests was tried first
        assert result['scrape_method'] == 'cloudscraper'

    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', False)
    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False)
    @patch('app.services.scraper.requests.get')
    def test_http_403_with_content_returns_best_effort(self, mock_get):
        """HTTP 403 with real content in the body returns best-effort instead of error."""
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.text = _make_article_html(100, 'Blocked But Has Content')
        mock_get.return_value = mock_resp

        result = fetch_and_parse('https://celebrity-site.com/article')

        assert result['scrape_method'] == 'requests'
        assert result['word_count'] >= 50
        assert result['title'] == 'Blocked But Has Content'

    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', False)
    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False)
    @patch('app.services.scraper.requests.get')
    def test_http_403_with_thin_content_returns_best_effort(self, mock_get):
        """HTTP 403 with thin content still returns best-effort rather than ScrapeError."""
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.text = _make_thin_html()
        mock_get.return_value = mock_resp

        result = fetch_and_parse('https://celebrity-site.com/blocked')

        # Thin but still returned as best-effort (not a ScrapeError)
        assert result['scrape_method'] == 'requests'

    @patch('app.services.scraper.fetch_with_cloudscraper')
    @patch('app.services.scraper.CLOUDSCRAPER_AVAILABLE', True)
    @patch('app.services.scraper.PLAYWRIGHT_AVAILABLE', False)
    @patch('app.services.scraper.requests.get')
    def test_http_403_escalates_to_cloudscraper(self, mock_get, mock_cs):
        """HTTP 403 triggers escalation to cloudscraper which gets real content."""
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.text = _make_thin_html()
        mock_get.return_value = mock_resp

        mock_cs.return_value = _make_article_html(100, 'Full Article via CS')

        result = fetch_and_parse('https://celebrity-site.com/article')

        assert result['scrape_method'] == 'cloudscraper'
        assert result['word_count'] >= 50

    @patch('app.services.scraper.requests.get')
    def test_cache_hit_skips_fetch(self, mock_get):
        """Second call for same URL returns cached result."""
        mock_resp = MagicMock()
        mock_resp.text = _make_article_html(100, 'Cached')
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        result1 = fetch_and_parse('https://example.com/cached')
        result2 = fetch_and_parse('https://example.com/cached')

        assert mock_get.call_count == 1
        assert result1 == result2
