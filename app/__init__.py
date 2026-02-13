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


def _ensure_schema(app):
    """Add new columns and tables if they don't exist yet.

    This handles schema evolution for deployments where Flask-Migrate
    isn't used. Each statement is idempotent (IF NOT EXISTS / IF EXISTS).
    """
    with app.app_context():
        try:
            # New columns on articles table
            db.session.execute(db.text(
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS "
                "line_height VARCHAR(10) DEFAULT 'default'"
            ))
            db.session.execute(db.text(
                "ALTER TABLE articles ADD COLUMN IF NOT EXISTS "
                "margin_width VARCHAR(10) DEFAULT 'default'"
            ))

            # New bookmarks table
            db.session.execute(db.text("""
                CREATE TABLE IF NOT EXISTS bookmarks (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL REFERENCES user_profiles(id),
                    article_id VARCHAR(36) NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
                    page_number INTEGER NOT NULL,
                    label VARCHAR(200),
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    CONSTRAINT uq_bookmark_article_page UNIQUE (article_id, page_number)
                )
            """))
            db.session.execute(db.text(
                "CREATE INDEX IF NOT EXISTS ix_bookmarks_article ON bookmarks (article_id)"
            ))

            # New highlights table
            db.session.execute(db.text("""
                CREATE TABLE IF NOT EXISTS highlights (
                    id VARCHAR(36) PRIMARY KEY,
                    user_id VARCHAR(36) NOT NULL REFERENCES user_profiles(id),
                    article_id VARCHAR(36) NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
                    start_xpath VARCHAR(500) NOT NULL,
                    start_offset INTEGER NOT NULL,
                    end_xpath VARCHAR(500) NOT NULL,
                    end_offset INTEGER NOT NULL,
                    selected_text TEXT NOT NULL,
                    note TEXT,
                    color VARCHAR(20) DEFAULT 'yellow',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            db.session.execute(db.text(
                "CREATE INDEX IF NOT EXISTS ix_highlights_article ON highlights (article_id)"
            ))

            db.session.commit()
            app.logger.info('Schema migration check completed')
        except Exception as e:
            db.session.rollback()
            app.logger.warning('Schema migration check failed: %s', e)


def create_app():
    app = Flask(__name__, static_folder=None)

    config = ProdConfig if os.environ.get('FLASK_ENV') == 'production' else DevConfig
    app.config.from_object(config)

    _configure_logging(app)

    db.init_app(app)
    migrate.init_app(app, db)

    # Ensure new schema elements exist in the database
    _ensure_schema(app)

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
