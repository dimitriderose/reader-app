def register_blueprints(app):
    from app.api.articles import bp as articles_bp
    from app.api.collections import bp as collections_bp
    from app.api.history import bp as history_bp
    from app.api.fetch import bp as fetch_bp
    from app.api.user import bp as user_bp

    app.register_blueprint(articles_bp)
    app.register_blueprint(collections_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(fetch_bp)
    app.register_blueprint(user_bp)
