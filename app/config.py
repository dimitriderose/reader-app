import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', '')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SUPABASE_URL = os.environ.get('SUPABASE_URL', '')
    SUPABASE_PUBLISHABLE_KEY = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
    WORDS_PER_MINUTE = 225

class DevConfig(Config):
    DEBUG = True

class ProdConfig(Config):
    DEBUG = False

class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
