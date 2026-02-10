import json
from tests.conftest import TEST_USER_ID


def _make_history_payload(**overrides):
    """Build a default history entry payload."""
    payload = {
        'title': 'Test History Entry',
        'source_url': 'https://example.com/article',
        'content_html': '<p>History content</p>',
        'content_hash': 'abc123def456',
        'current_page': 1,
        'total_pages': 10,
    }
    payload.update(overrides)
    return payload


class TestUpsertHistory:
    """POST /api/history — upsert on (user_id, content_hash)"""

    def test_create_new_history_entry(self, client):
        resp = client.post(
            '/api/history',
            data=json.dumps(_make_history_payload()),
            content_type='application/json',
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert 'entry' in data
        assert data['entry']['title'] == 'Test History Entry'
        assert data['entry']['id'] is not None

    def test_upsert_updates_existing_entry(self, client):
        """Same content_hash should update the existing entry, not create a duplicate."""
        payload = _make_history_payload(content_hash='same_hash_123')

        # First insert
        resp1 = client.post(
            '/api/history',
            data=json.dumps(payload),
            content_type='application/json',
        )
        assert resp1.status_code == 201
        entry_id = resp1.get_json()['entry']['id']

        # Second insert with same content_hash but updated page
        payload['current_page'] = 5
        resp2 = client.post(
            '/api/history',
            data=json.dumps(payload),
            content_type='application/json',
        )
        # Upsert returns 200 (not 201) for existing entry
        assert resp2.status_code == 200
        updated_entry = resp2.get_json()['entry']
        assert updated_entry['id'] == entry_id
        assert updated_entry['current_page'] == 5

        # Verify only one entry exists
        resp = client.get('/api/history')
        entries = resp.get_json()['entries']
        assert len(entries) == 1

    def test_create_history_missing_content_hash_returns_400(self, client):
        payload = _make_history_payload()
        del payload['content_hash']
        resp = client.post(
            '/api/history',
            data=json.dumps(payload),
            content_type='application/json',
        )
        assert resp.status_code == 400

    def test_create_history_missing_title_returns_400(self, client):
        payload = _make_history_payload()
        del payload['title']
        resp = client.post(
            '/api/history',
            data=json.dumps(payload),
            content_type='application/json',
        )
        assert resp.status_code == 400


class TestListHistory:
    """GET /api/history"""

    def test_list_history_empty(self, client):
        resp = client.get('/api/history')
        assert resp.status_code == 200
        assert resp.get_json()['entries'] == []

    def test_list_history_no_content_html(self, client):
        """List response should NOT include content_html."""
        client.post(
            '/api/history',
            data=json.dumps(_make_history_payload()),
            content_type='application/json',
        )

        resp = client.get('/api/history')
        entries = resp.get_json()['entries']
        assert len(entries) == 1
        assert 'content_html' not in entries[0]

    def test_list_history_has_expected_fields(self, client):
        client.post(
            '/api/history',
            data=json.dumps(_make_history_payload()),
            content_type='application/json',
        )

        resp = client.get('/api/history')
        entry = resp.get_json()['entries'][0]
        for field in ['id', 'title', 'source_domain', 'current_page',
                       'total_pages', 'article_id', 'opened_at']:
            assert field in entry, f"Missing field: {field}"

    def test_list_history_ordered_by_opened_at_desc(self, client):
        """Most recently opened entries should appear first."""
        client.post(
            '/api/history',
            data=json.dumps(_make_history_payload(
                title='First', content_hash='hash1'
            )),
            content_type='application/json',
        )
        client.post(
            '/api/history',
            data=json.dumps(_make_history_payload(
                title='Second', content_hash='hash2'
            )),
            content_type='application/json',
        )

        resp = client.get('/api/history')
        entries = resp.get_json()['entries']
        assert len(entries) == 2
        assert entries[0]['title'] == 'Second'
        assert entries[1]['title'] == 'First'


class TestGetHistoryEntry:
    """GET /api/history/<id>"""

    def test_get_history_entry_with_content(self, client):
        resp = client.post(
            '/api/history',
            data=json.dumps(_make_history_payload()),
            content_type='application/json',
        )
        entry_id = resp.get_json()['entry']['id']

        resp = client.get(f'/api/history/{entry_id}')
        assert resp.status_code == 200
        entry = resp.get_json()['entry']
        assert 'content_html' in entry
        assert entry['content_html'] == '<p>History content</p>'

    def test_get_history_entry_not_found(self, client):
        resp = client.get('/api/history/nonexistent-id')
        assert resp.status_code == 404


class TestUpdateHistoryPosition:
    """PATCH /api/history/<id>/position"""

    def test_update_position(self, client):
        resp = client.post(
            '/api/history',
            data=json.dumps(_make_history_payload()),
            content_type='application/json',
        )
        entry_id = resp.get_json()['entry']['id']

        resp = client.patch(
            f'/api/history/{entry_id}/position',
            data=json.dumps({'current_page': 7, 'total_pages': 10}),
            content_type='application/json',
        )
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        # Verify
        resp = client.get(f'/api/history/{entry_id}')
        entry = resp.get_json()['entry']
        assert entry['current_page'] == 7


class TestDeleteHistoryEntry:
    """DELETE /api/history/<id>"""

    def test_delete_single_entry(self, client):
        resp = client.post(
            '/api/history',
            data=json.dumps(_make_history_payload()),
            content_type='application/json',
        )
        entry_id = resp.get_json()['entry']['id']

        resp = client.delete(f'/api/history/{entry_id}')
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        # Verify gone
        resp = client.get(f'/api/history/{entry_id}')
        assert resp.status_code == 404

    def test_delete_nonexistent_entry(self, client):
        resp = client.delete('/api/history/nonexistent-id')
        assert resp.status_code == 404


class TestClearHistory:
    """DELETE /api/history/clear"""

    def test_clear_all_history(self, client):
        # Create multiple entries
        client.post(
            '/api/history',
            data=json.dumps(_make_history_payload(content_hash='h1')),
            content_type='application/json',
        )
        client.post(
            '/api/history',
            data=json.dumps(_make_history_payload(content_hash='h2')),
            content_type='application/json',
        )
        client.post(
            '/api/history',
            data=json.dumps(_make_history_payload(content_hash='h3')),
            content_type='application/json',
        )

        # Verify 3 entries exist
        resp = client.get('/api/history')
        assert len(resp.get_json()['entries']) == 3

        # Clear all
        resp = client.delete('/api/history/clear')
        assert resp.status_code == 200
        assert resp.get_json()['ok'] is True

        # Verify all gone
        resp = client.get('/api/history')
        assert len(resp.get_json()['entries']) == 0
