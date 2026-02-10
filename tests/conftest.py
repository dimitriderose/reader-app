import uuid
from functools import wraps

import pytest
from flask import g

# Patch auth decorators BEFORE importing create_app, so blueprints
# are registered with the mocked versions.
import app.middleware.auth as auth_module

TEST_USER_ID = str(uuid.uuid4())

_original_require_auth = auth_module.require_auth
_original_optional_auth = auth_module.optional_auth


def _mock_require_auth(f):
    """Mock require_auth: skip JWT validation, set g.user_id to test UUID."""
    @wraps(f)
    def decorated(*args, **kwargs):
        from app.models.user_profile import UserProfile
        g.user_id = TEST_USER_ID
        g.user_profile = UserProfile.query.get(TEST_USER_ID)
        g.jwt_payload = {'sub': TEST_USER_ID, 'email': 'test@example.com'}
        return f(*args, **kwargs)
    return decorated


def _mock_optional_auth(f):
    """Mock optional_auth: set g.user_id to test UUID."""
    @wraps(f)
    def decorated(*args, **kwargs):
        from app.models.user_profile import UserProfile
        g.user_id = TEST_USER_ID
        g.user_profile = UserProfile.query.get(TEST_USER_ID)
        g.jwt_payload = {'sub': TEST_USER_ID, 'email': 'test@example.com'}
        return f(*args, **kwargs)
    return decorated


# Apply patches before any blueprint imports
auth_module.require_auth = _mock_require_auth
auth_module.optional_auth = _mock_optional_auth

from app import create_app
from app.extensions import db as _db
from app.config import TestConfig
from app.models.user_profile import UserProfile


@pytest.fixture
def app():
    """Create a test Flask application with SQLite in-memory database."""
    application = create_app()
    application.config.from_object(TestConfig)

    with application.app_context():
        _db.create_all()

        # Create a test user profile
        profile = UserProfile(
            id=TEST_USER_ID,
            display_name='Test User',
        )
        _db.session.add(profile)
        _db.session.commit()

        yield application

        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    """Create a test client with mocked JWT auth."""
    with app.test_client() as test_client:
        yield test_client
