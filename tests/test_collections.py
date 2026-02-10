import json
from tests.conftest import TEST_USER_ID


def _make_collection_payload(**overrides):
    """Build a default collection payload."""
    payload = {
        'name': 'Test Collection',
        'color': 'purple',
    }
    payload.update(overrides)
    return payload


def _make_article_payload(**overrides):
    """Build a default article payload."""
    payload = {
        'title': 'Test Article',
        'source_url': 'https://example.com/post',
        'content_html': '<p>Test content</p>',
        'current_page': 1,
        'total_pages': 5,
    }
    payload.update(overrides)
    return payload


class TestCreateCollection:
    """POST /api/collections"""

    def test_create_collection(self, client):
        resp = client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload()),
            content_type='application/json',
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert 'collection' in data
        assert data['collection']['name'] == 'Test Collection'
        assert data['collection']['color'] == 'purple'

    def test_create_collection_default_color(self, client):
        resp = client.post(
            '/api/collections',
            data=json.dumps({'name': 'No Color'}),
            content_type='application/json',
        )
        assert resp.status_code == 201
        assert resp.get_json()['collection']['color'] == 'blue'

    def test_create_collection_duplicate_name_returns_400(self, client):
        client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload(name='Unique')),
            content_type='application/json',
        )
        resp = client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload(name='Unique')),
            content_type='application/json',
        )
        assert resp.status_code == 400

    def test_create_collection_missing_name_returns_400(self, client):
        resp = client.post(
            '/api/collections',
            data=json.dumps({'color': 'red'}),
            content_type='application/json',
        )
        assert resp.status_code == 400


class TestListCollections:
    """GET /api/collections"""

    def test_list_collections_empty(self, client):
        resp = client.get('/api/collections')
        assert resp.status_code == 200
        assert resp.get_json()['collections'] == []

    def test_list_collections_with_article_count(self, client):
        # Create a collection
        resp = client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload(name='Tech')),
            content_type='application/json',
        )
        collection_id = resp.get_json()['collection']['id']

        # Create an article in that collection
        client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload(collection_id=collection_id)),
            content_type='application/json',
        )

        # List collections
        resp = client.get('/api/collections')
        collections = resp.get_json()['collections']
        assert len(collections) == 1
        assert collections[0]['name'] == 'Tech'
        assert collections[0]['article_count'] == 1

    def test_list_collections_has_expected_fields(self, client):
        client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload()),
            content_type='application/json',
        )

        resp = client.get('/api/collections')
        collection = resp.get_json()['collections'][0]
        for field in ['id', 'name', 'color', 'position', 'article_count']:
            assert field in collection, f"Missing field: {field}"


class TestUpdateCollection:
    """PATCH /api/collections/<id>"""

    def test_update_collection_name(self, client):
        resp = client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload(name='Old Name')),
            content_type='application/json',
        )
        collection_id = resp.get_json()['collection']['id']

        resp = client.patch(
            f'/api/collections/{collection_id}',
            data=json.dumps({'name': 'New Name'}),
            content_type='application/json',
        )
        assert resp.status_code == 200
        assert resp.get_json()['collection']['name'] == 'New Name'

    def test_update_collection_color(self, client):
        resp = client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload()),
            content_type='application/json',
        )
        collection_id = resp.get_json()['collection']['id']

        resp = client.patch(
            f'/api/collections/{collection_id}',
            data=json.dumps({'color': 'green'}),
            content_type='application/json',
        )
        assert resp.status_code == 200
        assert resp.get_json()['collection']['color'] == 'green'

    def test_update_collection_not_found(self, client):
        resp = client.patch(
            '/api/collections/nonexistent-id',
            data=json.dumps({'name': 'X'}),
            content_type='application/json',
        )
        assert resp.status_code == 404


class TestDeleteCollection:
    """DELETE /api/collections/<id>"""

    def test_delete_collection(self, client):
        resp = client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload()),
            content_type='application/json',
        )
        collection_id = resp.get_json()['collection']['id']

        resp = client.delete(f'/api/collections/{collection_id}')
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        # Verify gone
        resp = client.get('/api/collections')
        assert len(resp.get_json()['collections']) == 0

    def test_delete_collection_cascades_articles_to_uncategorized(self, client):
        """When a collection is deleted, its articles become uncategorized (collection_id = NULL)."""
        # Create collection
        resp = client.post(
            '/api/collections',
            data=json.dumps(_make_collection_payload(name='To Delete')),
            content_type='application/json',
        )
        collection_id = resp.get_json()['collection']['id']

        # Create article in that collection
        resp = client.post(
            '/api/articles',
            data=json.dumps(_make_article_payload(collection_id=collection_id)),
            content_type='application/json',
        )
        article_id = resp.get_json()['article']['id']

        # Delete collection
        client.delete(f'/api/collections/{collection_id}')

        # Verify article still exists but has null collection_id
        resp = client.get(f'/api/articles/{article_id}')
        assert resp.status_code == 200
        assert resp.get_json()['article']['collection_id'] is None

    def test_delete_nonexistent_collection(self, client):
        resp = client.delete('/api/collections/nonexistent-id')
        assert resp.status_code == 404
