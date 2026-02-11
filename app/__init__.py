import logging
import os
import sys

from flask import Flask, jsonify, send_from_directory
from .extensions import db, migrate
from .config import DevConfig, ProdConfig


def _configure_logging(app):
    """Set up structured logging for production."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        '[%(asctime)s] %(levelname)s in %(module)s: %(message)s'
    ))
    level = logging.INFO if not app.debug else logging.DEBUG
    app.logger.setLevel(level)
    app.logger.addHandler(handler)
    logging.getLogger('gunicorn.error').setLevel(level)


def create_app():
    app = Flask(__name__, static_folder=None)

    config = ProdConfig if os.environ.get('FLASK_ENV') == 'production' else DevConfig
    app.config.from_object(config)

    _configure_logging(app)

    db.init_app(app)
    migrate.init_app(app, db)

    # Enable CORS (M6)
    from flask_cors import CORS
    CORS(app)

    # Register blueprints
    from .api import register_blueprints
    register_blueprints(app)

    # Import models so they are registered with SQLAlchemy (needed for migrations)
    from . import models  # noqa: F401

    # Health check endpoint (used by Railway, Docker, and CI)
    @app.route('/healthz')
    def health_check():
        try:
            db.session.execute(db.text('SELECT 1'))
            return jsonify(status='healthy'), 200
        except Exception:
            app.logger.exception('Health check failed')
            return jsonify(status='unhealthy'), 503

    # Serve Vite build in production (SPA catch-all)
    dist = os.path.join(os.path.dirname(__file__), 'static', 'dist')
    if os.path.exists(dist):
        @app.route('/', defaults={'path': ''})
        @app.route('/<path:path>')
        def serve_spa(path):
            if path and os.path.exists(os.path.join(dist, path)):
                return send_from_directory(dist, path)
            return send_from_directory(dist, 'index.html')

    return app
