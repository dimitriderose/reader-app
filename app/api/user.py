from flask import Blueprint, jsonify, g, request
from app.middleware.auth import require_auth
from app.extensions import db

bp = Blueprint('user', __name__, url_prefix='/api/user')


@bp.route('/profile', methods=['GET'])
@require_auth
def get_profile():
    profile = g.user_profile
    email = g.jwt_payload.get('email', '')
    return jsonify({
        'profile': {
            'display_name': profile.display_name,
            'email': email,
            'avatar_url': profile.avatar_url,
            'sort_preference': profile.sort_preference,
        }
    })


@bp.route('/preferences', methods=['PATCH'])
@require_auth
def update_preferences():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Request body is required'}), 400
    if 'sort_preference' in data:
        if data['sort_preference'] in ('lastread', 'saved', 'progress'):
            g.user_profile.sort_preference = data['sort_preference']
            db.session.commit()

    return jsonify({'ok': True})
