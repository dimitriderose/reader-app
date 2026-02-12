"""Tests for the scraper with MSN content API and Edge URL unwrapping."""

from unittest.mock import patch, MagicMock

import pytest

from app.services.scraper import (
    fetch_and_parse,
    extract_text_and_nav_from_html,
    _clean_url,
    _fetch_msn_article,
    _MSN_ARTICLE_RE,
    extract_domain,
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


# ---------------------------------------------------------------------------
# _clean_url
# ---------------------------------------------------------------------------

class TestCleanUrl:
    def test_unwraps_edge_reader_url(self):
        edge_url = (
            'read://https_www.msn.com/?url=https%3A%2F%2Fwww.msn.com'
            '%2Fen-us%2Fnews%2Farticle%2Far-AA1W6rzz'
        )
        assert _clean_url(edge_url) == 'https://www.msn.com/en-us/news/article/ar-AA1W6rzz'

    def test_passes_normal_url_through(self):
        url = 'https://example.com/article'
        assert _clean_url(url) == url

    def test_passes_http_url_through(self):
        url = 'http://example.com/page'
        assert _clean_url(url) == url


# ---------------------------------------------------------------------------
# extract_domain
# ---------------------------------------------------------------------------

class TestExtractDomain:
    def test_extracts_domain(self):
        assert extract_domain('https://www.nytimes.com/article') == 'nytimes.com'

    def test_strips_www(self):
        assert extract_domain('https://www.example.com') == 'example.com'


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
# _fetch_msn_article / MSN content API
# ---------------------------------------------------------------------------

class TestMsnApi:
    def test_regex_extracts_locale_and_id(self):
        """Regex correctly parses locale and article ID from MSN URLs."""
        url = 'https://www.msn.com/en-us/news/technology/some-article/ar-AA1VZ8we?ocid=foo'
        match = _MSN_ARTICLE_RE.search(url)
        assert match is not None
        assert match.group(1) == 'en-us'
        assert match.group(2) == 'AA1VZ8we'

    def test_regex_various_locales(self):
        url = 'https://www.msn.com/fr-fr/actualite/monde/some-slug/ar-BB2xYz99'
        match = _MSN_ARTICLE_RE.search(url)
        assert match is not None
        assert match.group(1) == 'fr-fr'
        assert match.group(2) == 'BB2xYz99'

    def test_non_msn_url_returns_none(self):
        assert _fetch_msn_article('https://example.com/article') is None
        assert _fetch_msn_article('https://cnn.com/news/story') is None

    @patch('app.services.scraper.requests.get')
    def test_msn_article_url_uses_api(self, mock_get):
        """MSN URL triggers API call and returns msn_api scrape method."""
        words = ' '.join(['word'] * 100)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            'title': 'Test MSN Article',
            'body': f'<p>{words}</p>',
        }
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = _fetch_msn_article(
            'https://www.msn.com/en-us/news/tech/some-slug/ar-AA1VZ8we'
        )

        assert result is not None
        assert result['scrape_method'] == 'msn_api'
        assert result['title'] == 'Test MSN Article'
        assert result['word_count'] >= 50
        mock_get.assert_called_once()
        call_url = mock_get.call_args[0][0]
        assert 'assets.msn.com' in call_url
        assert 'AA1VZ8we' in call_url

    @patch('app.services.scraper.requests.get')
    def test_msn_api_failure_returns_none(self, mock_get):
        """When MSN API fails, returns None so default scraper can run."""
        mock_get.side_effect = Exception('API down')

        result = _fetch_msn_article(
            'https://www.msn.com/en-us/news/tech/some-slug/ar-AA1VZ8we'
        )
        assert result is None

    @patch('app.services.scraper.requests.get')
    def test_msn_api_empty_body_returns_none(self, mock_get):
        """When MSN API returns no body, returns None."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {'title': 'Title', 'body': ''}
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = _fetch_msn_article(
            'https://www.msn.com/en-us/news/tech/some-slug/ar-AA1VZ8we'
        )
        assert result is None


# ---------------------------------------------------------------------------
# fetch_and_parse integration
# ---------------------------------------------------------------------------

class TestFetchAndParse:
    @patch('app.services.scraper._fetch_msn_article')
    @patch('app.services.scraper.requests.get')
    def test_msn_url_uses_api(self, mock_get, mock_msn):
        """fetch_and_parse tries MSN API before the default HTTP fetch."""
        words = ' '.join(['word'] * 100)
        mock_msn.return_value = {
            'title': 'MSN Article',
            'content_html': f'<p>{words}</p>',
            'word_count': 100,
            'source_domain': 'msn.com',
            'scrape_method': 'msn_api',
        }

        result = fetch_and_parse(
            'https://www.msn.com/en-us/news/tech/slug/ar-AA1VZ8we'
        )

        assert result['scrape_method'] == 'msn_api'
        mock_get.assert_not_called()  # default fetch never reached

    @patch('app.services.scraper._fetch_msn_article')
    @patch('app.services.scraper.requests.get')
    def test_msn_api_failure_falls_back(self, mock_get, mock_msn):
        """When MSN API returns None, fetch_and_parse falls through to HTTP fetch."""
        mock_msn.return_value = None

        mock_resp = MagicMock()
        mock_resp.text = _make_article_html(100, 'Fallback Article')
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = fetch_and_parse(
            'https://www.msn.com/en-us/news/tech/slug/ar-AA1VZ8we'
        )

        assert result['title'] == 'Fallback Article'
        mock_get.assert_called_once()

    @patch('app.services.scraper.requests.get')
    def test_normal_url_fetches_directly(self, mock_get):
        """Non-MSN URLs go straight to HTTP fetch."""
        mock_resp = MagicMock()
        mock_resp.text = _make_article_html(100, 'Normal Article')
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        result = fetch_and_parse('https://example.com/article')

        assert result['title'] == 'Normal Article'
        assert result['word_count'] >= 50

    @patch('app.services.scraper.requests.get')
    def test_edge_reader_url_unwrapped(self, mock_get):
        """Edge read:// URLs are unwrapped before fetching."""
        mock_resp = MagicMock()
        mock_resp.text = _make_article_html(100, 'Unwrapped')
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        fetch_and_parse(
            'read://https_example.com/?url=https%3A%2F%2Fexample.com%2Farticle'
        )

        # Verify the actual HTTP call used the unwrapped URL
        call_url = mock_get.call_args[0][0]
        assert call_url == 'https://example.com/article'
