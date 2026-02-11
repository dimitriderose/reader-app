import os
from dotenv import load_dotenv

load_dotenv()

def _fix_db_url(url):
    """Fix common DATABASE_URL issues for SQLAlchemy compatibility."""
    if not url:
        return 'sqlite:///app.db'
    # Supabase/Heroku use postgres:// but SQLAlchemy requires postgresql://
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url

class Config:
    SQLALCHEMY_DATABASE_URI = _fix_db_url(os.environ.get('DATABASE_URL', ''))
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
    SUPABASE_PUBLISHABLE_KEY = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
    WORDS_PER_MINUTE = 225

    # Scraper settings
    SCRAPER_REQUEST_TIMEOUT = int(os.environ.get('SCRAPER_REQUEST_TIMEOUT', '15'))
    SCRAPER_BROWSER_TIMEOUT = int(os.environ.get('SCRAPER_BROWSER_TIMEOUT', '30000'))
    SCRAPER_CACHE_TTL = int(os.environ.get('SCRAPER_CACHE_TTL', '300'))
    SCRAPER_THIN_THRESHOLD = int(os.environ.get('SCRAPER_THIN_THRESHOLD', '50'))

class DevConfig(Config):
    DEBUG = True

class ProdConfig(Config):
    DEBUG = False

class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
