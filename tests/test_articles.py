import json
from tests.conftest import TEST_USER_ID


def _make_article_payload(**overrides):
    """Build a default article payload for POST /api/articles."""
    payload = {
        'title': 'Test Article',
        'source_url': 'https://www.example.com/post/1',
        'content_html': '<p>Hello world this is a test article with several words</p>',
        'current_page': 1,
        'total_pages': 5,
        'font_size': 20,
        'font_family': 'serif',
        'theme': 'light',
    }
    payload.update(overrides)
    return payload


class TestSaveArticle:
    """POST /api/articles"""

    def test_save_article_returns_201(self, client):
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert 'article' in data
        assert data['article']['title'] == 'Test Article'
        assert data['article']['id'] is not None

    def test_save_article_computes_word_count(self, client):
        """word_count is computed server-side from content_html, not sent by client."""
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )
        data = resp.get_json()
        article = data['article']
        # content_html has "Hello world this is a test article with several words" = 10 words
        assert article['word_count'] == 10

    def test_save_article_extracts_source_domain(self, client):
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload(
                source_url='https://www.nytimes.com/article/test'
            )),
            content_type='application/json',
        )
        data = resp.get_json()
        assert data['article']['source_domain'] == 'nytimes.com'

    def test_save_article_missing_title_returns_400(self, client):
        payload = _make_article_payload()
        del payload['title']
        resp = client.post(
            '/api/articles',
            data=json.dumps(payload),
            content_type='application/json',
        )
        assert resp.status_code == 400

    def test_save_article_missing_content_returns_400(self, client):
        payload = _make_article_payload()
        del payload['content_html']
        resp = client.post(
            '/api/articles',
            data=json.dumps(payload),
            content_type='application/json',
        )
        assert resp.status_code == 400


class TestListArticles:
    """GET /api/articles"""

    def test_list_articles_empty(self, client):
        resp = client.get('/api/articles')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['articles'] == []

    def test_list_articles_no_content_html(self, client):
        """List response should NOT include content_html."""
        # Create an article first
        client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )

        resp = client.get('/api/articles')
        data = resp.get_json()
        assert len(data['articles']) == 1
        assert 'content_html' not in data['articles'][0]

    def test_list_articles_has_expected_fields(self, client):
        client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )

        resp = client.get('/api/articles')
        article = resp.get_json()['articles'][0]
        expected_fields = [
            'id', 'title', 'source_url', 'source_domain', 'word_count',
            'current_page', 'total_pages', 'font_size', 'font_family',
            'theme', 'collection_id', 'last_read_at', 'saved_at',
        ]
        for field in expected_fields:
            assert field in article, f"Missing field: {field}"


class TestGetArticle:
    """GET /api/articles/<id>"""

    def test_get_article_includes_content_html(self, client):
        # Create
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )
        article_id = resp.get_json()['article']['id']

        # Get
        resp = client.get(f'/api/articles/{article_id}')
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'content_html' in data['article']
        assert data['article']['content_html'] == '<p>Hello world this is a test article with several words</p>'

    def test_get_article_not_found(self, client):
        resp = client.get('/api/articles/nonexistent-id')
        assert resp.status_code == 404


class TestUpdatePosition:
    """PATCH /api/articles/<id>/position"""

    def test_update_position(self, client):
        # Create article
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )
        article_id = resp.get_json()['article']['id']

        # Update position
        resp = client.patch(
            f'/api/articles/{article_id}/position',
            data=json.dumps({'current_page': 3, 'total_pages': 5}),
            content_type='application/json',
        )
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        # Verify
        resp = client.get(f'/api/articles/{article_id}')
        article = resp.get_json()['article']
        assert article['current_page'] == 3
        assert article['total_pages'] == 5
        assert article['last_read_at'] is not None

    def test_update_position_sendbeacon_text_plain(self, client):
        """sendBeacon may send with Content-Type text/plain."""
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )
        article_id = resp.get_json()['article']['id']

        # Simulate sendBeacon with text/plain content type
        resp = client.patch(
            f'/api/articles/{article_id}/position',
            data=json.dumps({'current_page': 4, 'total_pages': 5}),
            content_type='text/plain',
        )
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        # Verify position was updated
        resp = client.get(f'/api/articles/{article_id}')
        assert resp.get_json()['article']['current_page'] == 4


class TestDeleteArticle:
    """DELETE /api/articles/<id>"""

    def test_delete_article(self, client):
        # Create
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )
        article_id = resp.get_json()['article']['id']

        # Delete
        resp = client.delete(f'/api/articles/{article_id}')
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        # Verify gone
        resp = client.get(f'/api/articles/{article_id}')
        assert resp.status_code == 404

    def test_delete_nonexistent_article(self, client):
        resp = client.delete('/api/articles/nonexistent-id')
        assert resp.status_code == 404


class TestSortOrders:
    """Test sort query parameter."""

    def test_sort_by_saved(self, client):
        # Create two articles
        client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload(title='First')),
            content_type='application/json',
        )
        client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload(title='Second')),
            content_type='application/json',
        )

        resp = client.get('/api/articles?sort=saved')
        articles = resp.get_json()['articles']
        assert len(articles) == 2
        # Most recently saved first
        assert articles[0]['title'] == 'Second'
        assert articles[1]['title'] == 'First'

    def test_sort_by_progress(self, client):
        # Create two articles with different progress
        resp1 = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload(
                title='Almost Done', current_page=4, total_pages=5
            )),
            content_type='application/json',
        )
        resp2 = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload(
                title='Just Started', current_page=1, total_pages=5
            )),
            content_type='application/json',
        )

        resp = client.get('/api/articles?sort=progress')
        articles = resp.get_json()['articles']
        assert len(articles) == 2
        # Least progress first
        assert articles[0]['title'] == 'Just Started'
        assert articles[1]['title'] == 'Almost Done'


class TestUpdateArticle:
    """PATCH /api/articles/<id>"""

    def test_update_metadata(self, client):
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload()),
            content_type='application/json',
        )
        article_id = resp.get_json()['article']['id']

        resp = client.patch(
            f'/api/articles/{article_id}',
            data=json.dumps({'font_size': 24, 'theme': 'dark'}),
            content_type='application/json',
        )
        assert resp.status_code == 200
        article = resp.get_json()['article']
        assert article['font_size'] == 24
        assert article['theme'] == 'dark'
        assert article['last_read_at'] is not None
