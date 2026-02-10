import os
from flask import Flask, send_from_directory
from .extensions import db, migrate
from .config import DevConfig, ProdConfig


def create_app():
    app = Flask(__name__, static_folder=None)

    config = ProdConfig if os.environ.get('FLASK_ENV') == 'production' else DevConfig
    app.config.from_object(config)

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
