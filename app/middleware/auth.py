import jwt
from jwt import PyJWKClient
from functools import wraps
from flask import request, jsonify, g, current_app
from app.extensions import db
from app.models.user_profile import UserProfile

# Module-level JWKS client (cached — avoids fetching keys on every request)
_jwks_client = None


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None:
        jwks_url = current_app.config['SUPABASE_URL'] + '/auth/v1/.well-known/jwks.json'
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True)
    return _jwks_client


def _decode_token(token):
    """Decode and verify a Supabase JWT using the JWKS endpoint (ES256)."""
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=['ES256'],
        audience='authenticated'
    )


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization', '')

        if auth_header.startswith('Bearer '):
            token = auth_header[7:]

        if not token:
            return jsonify({'error': 'Missing authorization token'}), 401

        try:
            payload = _decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401

        user_id = payload.get('sub')
        if not user_id:
            return jsonify({'error': 'Invalid token payload'}), 401

        # Auto-create profile on first request
        profile = UserProfile.query.get(user_id)
        if not profile:
            email = payload.get('email', '')
            display_name = email.split('@')[0] if email else 'User'
            avatar_url = payload.get('user_metadata', {}).get('avatar_url')

            profile = UserProfile(
                id=user_id,
                display_name=display_name,
                avatar_url=avatar_url,
            )
            db.session.add(profile)
            db.session.commit()

        g.user_id = user_id
        g.user_profile = profile
        g.jwt_payload = payload

        return f(*args, **kwargs)
    return decorated


def optional_auth(f):
    """Like require_auth but doesn't fail if no token present."""
    @wraps(f)
    def decorated(*args, **kwargs):
        g.user_id = None
        g.user_profile = None
        g.jwt_payload = None

        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
            try:
                payload = _decode_token(token)
                user_id = payload.get('sub')
                if user_id:
                    profile = UserProfile.query.get(user_id)
                    if profile:
                        g.user_id = user_id
                        g.user_profile = profile
                        g.jwt_payload = payload
            except jwt.InvalidTokenError:
                pass  # Proceed without auth

        return f(*args, **kwargs)
    return decorated
