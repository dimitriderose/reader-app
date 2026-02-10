# Implementation Guide: Reader App V1

## Prerequisites

Before starting, ensure you have:
- Python 3.11+
- Node.js 18+
- Docker Desktop
- A Supabase account (free tier: https://supabase.com)
- A Railway account (free tier: https://railway.app)
- A GitHub account (for OAuth provider setup and deployment)

## Supabase Project Setup

1. Create a new project at https://app.supabase.com
2. Note these values from Project Settings → API:
   - **Project URL** → `SUPABASE_URL`
   - **Publishable key** (`sb_publishable_...`) → `SUPABASE_PUBLISHABLE_KEY`
3. From Project Settings → Database:
   - **Connection string** (URI format) → `DATABASE_URL`
5. Enable auth providers (Authentication → Providers):
   - Email: enabled by default
   - Google: add Client ID and Secret from Google Cloud Console
   - GitHub: add Client ID and Secret from GitHub Developer Settings
6. Set the Site URL (Authentication → URL Configuration):
   - Development: `http://localhost:5173`
   - Production: your Railway URL (set after Phase 8)

---

## Phase 1: Project Scaffold

### Goal
Flask app factory + Vite dev server both running. No database yet.

### Files to create

**`requirements.txt`**
```
flask==3.1.*
flask-sqlalchemy==3.1.*
flask-migrate==4.1.*
flask-cors==5.0.*
psycopg2-binary==2.9.*
pyjwt[crypto]==2.10.*
python-dotenv==1.1.*
beautifulsoup4==4.13.*
requests==2.32.*
gunicorn==23.0.*
```

**`app/__init__.py`** — App factory
```python
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

    # Enable CORS (needed for direct API access and production)
    from flask_cors import CORS
    CORS(app)

    # Register blueprints
    from .api import register_blueprints
    register_blueprints(app)

    # Serve Vite build in production
    dist = os.path.join(os.path.dirname(__file__), 'static', 'dist')
    if os.path.exists(dist):
        @app.route('/', defaults={'path': ''})
        @app.route('/<path:path>')
        def serve_spa(path):
            if path and os.path.exists(os.path.join(dist, path)):
                return send_from_directory(dist, path)
            return send_from_directory(dist, 'index.html')

    return app
```

**`app/config.py`** — Configuration
```python
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
```

**`app/extensions.py`**
```python
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

db = SQLAlchemy()
migrate = Migrate()
```

**`app/api/__init__.py`**
```python
def register_blueprints(app):
    from .articles import bp as articles_bp
    from .collections import bp as collections_bp
    from .history import bp as history_bp
    from .fetch import bp as fetch_bp
    from .user import bp as user_bp

    app.register_blueprint(articles_bp)
    app.register_blueprint(collections_bp)
    app.register_blueprint(history_bp)
    app.register_blueprint(fetch_bp)
    app.register_blueprint(user_bp)
```

Create `app/middleware/__init__.py` (empty file — needed for Python package imports).

Create stub files for each blueprint (`app/api/articles.py`, `collections.py`, `history.py`, `fetch.py`, `user.py`) with an empty Blueprint:
```python
from flask import Blueprint
bp = Blueprint('articles', __name__, url_prefix='/api')
```

**`reader_app.py`** — Updated entry point

**Important:** Before overwriting this file, extract the scraper logic (`extract_text_and_nav_from_html()` and the URL fetching code) into `app/services/scraper.py` first. The existing code is the source material for the scraper service in Phase 4.

```python
from app import create_app
app = create_app()
```

**`.env.example`**
```
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJ...
FLASK_ENV=development
```

**`package.json`**
```json
{
  "name": "reader-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^6.0.0"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.47.0"
  }
}
```

**`vite.config.js`**
```javascript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  build: {
    outDir: resolve(__dirname, 'app/static/dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
```

**`src/index.html`** — Minimal shell (expanded in Phase 5)
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reader</title>
</head>
<body>
  <div id="app">Reader App — scaffold working</div>
  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

**`src/js/app.js`** — Minimal entry
```javascript
console.log('Reader App loaded');
```

**`Dockerfile`**
```dockerfile
# Stage 1: Build frontend
FROM node:18-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY src/ src/
COPY vite.config.js ./
RUN npx vite build

# Stage 2: Production
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=frontend /app/app/static/dist app/static/dist/
EXPOSE 5000
CMD gunicorn --bind 0.0.0.0:${PORT:-5000} reader_app:app
```

Note: Multi-stage build keeps the production image small (no Node.js) and avoids the build-order issue of purging Node before running Vite.

**`docker-compose.yml`**
```yaml
services:
  web:
    build: .
    ports:
      - "5000:5000"
    env_file:
      - .env
```

Note: `FLASK_ENV` is read from `.env` — defaults to `development` locally, set to `production` in Railway's environment variables.

**`.gitignore`** (update existing)
```
# Python
__pycache__/
*.pyc
.env
venv/
*.egg-info/

# Node
node_modules/
dist/

# Vite
app/static/dist/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
```

### Verify
```bash
# Terminal 1: Flask
pip install -r requirements.txt
cp .env.example .env  # fill in real values
flask run

# Terminal 2: Vite
npm install
npm run dev

# Visit http://localhost:5173 → should see "Reader App — scaffold working"
# Visit http://localhost:5000/api/ → should get 404 (no routes yet, but Flask is running)
```

---

## Phase 2: Database Models

### Goal
4 SQLAlchemy models created, migration run, tables exist in Supabase.

### Files to create

**`app/models/__init__.py`**
```python
from .user_profile import UserProfile
from .collection import Collection
from .article import Article
from .history import HistoryEntry
```

**`app/models/user_profile.py`**
```python
import uuid
from datetime import datetime, timezone
from app.extensions import db

class UserProfile(db.Model):
    __tablename__ = 'user_profiles'

    id = db.Column(db.String(36), primary_key=True)  # Supabase auth.users UUID
    display_name = db.Column(db.String(100), nullable=False)
    avatar_url = db.Column(db.String(500), nullable=True)
    sort_preference = db.Column(db.String(20), default='lastread')
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    articles = db.relationship('Article', backref='user', lazy='dynamic')
    collections = db.relationship('Collection', backref='user', lazy='dynamic')
    history_entries = db.relationship('HistoryEntry', backref='user', lazy='dynamic')
```

**`app/models/collection.py`**
```python
import uuid
from datetime import datetime, timezone
from app.extensions import db

class Collection(db.Model):
    __tablename__ = 'collections'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    color = db.Column(db.String(20), default='blue')
    position = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    articles = db.relationship('Article', backref='collection', lazy='dynamic')

    __table_args__ = (
        db.UniqueConstraint('user_id', 'name', name='uq_user_collection_name'),
    )
```

**`app/models/article.py`**
```python
import uuid
from datetime import datetime, timezone
from app.extensions import db

class Article(db.Model):
    __tablename__ = 'articles'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    collection_id = db.Column(db.String(36), db.ForeignKey('collections.id'), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    source_url = db.Column(db.String(2000), nullable=True)
    source_domain = db.Column(db.String(200), nullable=True)
    content_html = db.Column(db.Text, nullable=False)
    word_count = db.Column(db.Integer, default=0)
    current_page = db.Column(db.Integer, default=1)
    total_pages = db.Column(db.Integer, default=1)
    font_size = db.Column(db.Integer, default=20)
    font_family = db.Column(db.String(50), default='serif')
    theme = db.Column(db.String(10), default='light')
    last_read_at = db.Column(db.DateTime, nullable=True)
    saved_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.Index('ix_articles_user_lastread', 'user_id', last_read_at.desc()),
        db.Index('ix_articles_user_saved', 'user_id', saved_at.desc()),
        db.Index('ix_articles_user_collection', 'user_id', 'collection_id'),
    )
```

**`app/models/history.py`**
```python
import uuid
from datetime import datetime, timezone
from app.extensions import db

class HistoryEntry(db.Model):
    __tablename__ = 'history_entries'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.String(36), db.ForeignKey('user_profiles.id'), nullable=False)
    article_id = db.Column(db.String(36), db.ForeignKey('articles.id', ondelete='SET NULL'), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    source_url = db.Column(db.String(2000), nullable=True)
    source_domain = db.Column(db.String(200), nullable=True)
    content_html = db.Column(db.Text, nullable=False)
    current_page = db.Column(db.Integer, default=1)
    total_pages = db.Column(db.Integer, default=1)
    content_hash = db.Column(db.String(64), nullable=False)
    opened_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint('user_id', 'content_hash', name='uq_user_content_hash'),
    )
```

**Update `app/__init__.py`** — Add model imports before migrate.init_app:
```python
from . import models  # noqa: F401 — ensures models are registered
```

### Verify
```bash
flask db init        # creates migrations/ folder (first time only)
flask db migrate -m "initial schema"
flask db upgrade     # applies migration to Supabase PostgreSQL

# Check Supabase Dashboard → Table Editor → should see all 4 tables
```

---

## Phase 3: Auth Middleware

### Goal
JWT validation decorator that protects API endpoints. Auto-creates user profile on first request.

### Files to create

**`app/middleware/auth.py`**
```python
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
```

Note: `PyJWKClient` (from `pyjwt[crypto]`) fetches and caches the public keys from Supabase's JWKS endpoint. No shared secret is stored on our backend — verification uses the asymmetric ES256 public key.

**`app/api/user.py`**
```python
from flask import Blueprint, jsonify, g
from app.middleware.auth import require_auth

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
    from flask import request
    from app.extensions import db

    data = request.get_json()
    if 'sort_preference' in data:
        if data['sort_preference'] in ('lastread', 'saved', 'progress'):
            g.user_profile.sort_preference = data['sort_preference']
            db.session.commit()

    return jsonify({'ok': True})
```

### Verify
```bash
# 1. Sign up a user via Supabase Dashboard (Authentication → Users → Add user)
# 2. Get a JWT: Use the Supabase JS client or curl:
curl -X POST https://YOUR_PROJECT.supabase.co/auth/v1/token?grant_type=password \
  -H "apikey: YOUR_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}'

# 3. Call the profile endpoint:
curl http://localhost:5000/api/user/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
# → should return { profile: { display_name, email, ... } }
```

---

## Phase 4: Core API

### Goal
All REST endpoints working. Testable via curl/Postman.

### Files to create/update

**`app/services/scraper.py`** — Refactored from reader_app.py
Extract the HTML fetching and parsing logic from the existing `reader_app.py` into a clean service. Keep the BeautifulSoup text extraction, add word count calculation.

Key function signatures:
```python
def fetch_and_parse(url: str) -> dict:
    """Fetch URL, extract readable content.
    Returns: { title, content_html, word_count, source_domain }
    """

def extract_domain(url: str) -> str:
    """Extract domain from URL (e.g., 'nytimes.com')."""
```

**`app/services/word_count.py`**
```python
from bs4 import BeautifulSoup

def count_words(html: str) -> int:
    """Strip HTML tags and count words."""
    text = BeautifulSoup(html, 'html.parser').get_text(separator=' ')
    return len(text.split())

def reading_time_minutes(word_count: int, wpm: int = 225) -> int:
    """Estimated reading time in minutes."""
    return max(1, round(word_count / wpm))
```

**`app/api/fetch.py`**
```python
from flask import Blueprint, request, jsonify
from app.middleware.auth import optional_auth
from app.services.scraper import fetch_and_parse

bp = Blueprint('fetch', __name__, url_prefix='/api')

@bp.route('/fetch', methods=['POST'])
@optional_auth
def fetch_url():
    data = request.get_json()
    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'URL is required'}), 400

    try:
        result = fetch_and_parse(url)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 422
```

**`app/api/articles.py`** — Full CRUD implementation
Implement all 6 endpoints from the technical design. Key implementation details:

- `GET /api/articles` — Sort by `last_read_at DESC` (default), `saved_at DESC`, or progress (computed as `current_page / total_pages ASC`). Filter by `collection_id` query param. Return word_count and computed `reading_time_minutes`.
- `POST /api/articles` — Server computes `word_count` from `content_html` (client does NOT send it). Extract `source_domain` from `source_url`. Set `saved_at` to now.
- `PATCH /api/articles/:id/position` — Lightweight: only updates `current_page`, `total_pages`, and `last_read_at`. Must handle `sendBeacon` requests (Content-Type may be text/plain from Blob).
- `DELETE /api/articles/:id` — Verify `user_id` matches before deleting.

**Important for position endpoint:** sendBeacon sends with Content-Type `application/json` when using a Blob, but add a fallback:
```python
@bp.route('/articles/<article_id>/position', methods=['PATCH'])
@require_auth
def update_position(article_id):
    # Handle both JSON and sendBeacon
    if request.content_type and 'json' in request.content_type:
        data = request.get_json()
    else:
        data = request.get_json(force=True, silent=True) or {}
    # ... update article
```

**`app/api/collections.py`** — Full CRUD
- `GET /api/collections` — Include article count per collection using a subquery.
- `DELETE /api/collections/:id` — Set all `articles.collection_id = NULL` where it matches, then delete the collection.

**`app/api/history.py`** — Full CRUD with upsert
- `POST /api/history` — Upsert using `content_hash`. If entry with same `(user_id, content_hash)` exists, update `opened_at`, `current_page`, `total_pages`. Otherwise insert.
- `GET /api/history` — Order by `opened_at DESC`. Do NOT include `content_html` in list response (too heavy).
- `GET /api/history/:id` — Return full entry including `content_html` (needed to re-open article).
- `DELETE /api/history` (no ID) — Delete all entries for the authenticated user.

### Verify
```bash
# Save an article
curl -X POST http://localhost:5000/api/articles \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Article","source_url":"https://example.com","content_html":"<p>Hello world</p>","current_page":1,"total_pages":5}'

# List articles
curl http://localhost:5000/api/articles \
  -H "Authorization: Bearer TOKEN"

# Update position
curl -X PATCH http://localhost:5000/api/articles/ARTICLE_ID/position \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"current_page":3,"total_pages":5}'

# Create collection
curl -X POST http://localhost:5000/api/collections \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tech","color":"purple"}'

# Log history
curl -X POST http://localhost:5000/api/history \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","source_url":"https://example.com","content_html":"<p>Hello</p>","content_hash":"abc123","current_page":1,"total_pages":5}'
```

---

## Phase 5: Frontend — SPA Shell + Auth

### Goal
SPA shell with router, auth modal wired to Supabase, theme system working.

### Source extraction strategy

Extract from the 4 mockup HTML files:
1. Read each mockup's `<style>` block → split into corresponding CSS file
2. Read each mockup's `<script>` block → convert to ES module (replace IIFEs with exports)
3. Read the HTML structure → use as reference for dynamic rendering functions

### Files to create

**`src/css/base.css`** — Shared styles
Extract from all mockups: CSS custom properties (`:root`, `[data-theme]`), `.header`, `.header-right`, `.header-nav`, `.nav-link`, `.nav-divider`, `.user-avatar`, `.theme-dots`, `.theme-dot`, `.toast`, `.signin-btn`.

**`src/css/auth.css`** — Auth modal styles
Extract from `mockup_auth.html`: `.modal-backdrop`, `.auth-modal`, `.auth-state`, `.auth-field`, `.auth-input`, `.auth-submit`, `.oauth-btn`, `.forgot-*`, `.prompt-*`.

**`src/css/reader.css`** — Reader/flipbook styles
Extract from `design_v2.html`: `.flipbook-*`, `.toolbar`, `.bottom-bar`, input view styles.

**`src/css/library.css`** — Library styles
Extract from `mockup_library.html`: `.sidebar`, `.collection-*`, `.cards-grid`, `.article-card`, `.progress-*`, `.card-*`, `.sort-*`.

**`src/css/history.css`** — History styles
Extract from `mockup_history.html`: `.date-group`, `.history-entry`, `.entry-*`, `.progress-ring`, `.clear-*`.

**`src/js/supabase.js`**
```javascript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

let pendingSave = null;

export function setPendingSave(data) {
    pendingSave = data;
}

// Listen for auth state changes
supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && pendingSave) {
        const { api } = await import('./api.js');
        try {
            await api.post('/api/articles', pendingSave);
            const { showToast } = await import('./toast.js');
            showToast('Saved to library', 'success');
        } catch (e) {
            console.error('Pending save failed:', e);
        }
        pendingSave = null;
    }
});

export async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
}

export async function getUser() {
    const { data } = await supabase.auth.getUser();
    return data.user;
}
```

Add to `.env.example` and `.env`:
```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

**`src/js/api.js`**
```javascript
import { getSession } from './supabase.js';

async function request(method, path, body = null) {
    const session = await getSession();
    const headers = { 'Content-Type': 'application/json' };

    if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(path, options);

    if (res.status === 401) {
        // Trigger sign-in modal
        window.dispatchEvent(new CustomEvent('auth:required'));
        throw new Error('Authentication required');
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
    }

    return res.json();
}

export const api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
};
```

**`src/js/auth.js`**
Wire the auth modal from `mockup_auth.html` to Supabase calls:
- Sign in: `supabase.auth.signInWithPassword({ email, password })`
- Register: `supabase.auth.signUp({ email, password, options: { data: { display_name } } })`
- Google OAuth: `supabase.auth.signInWithOAuth({ provider: 'google' })`
- GitHub OAuth: `supabase.auth.signInWithOAuth({ provider: 'github' })`
- Forgot password: `supabase.auth.resetPasswordForEmail(email)`
- Sign out: `supabase.auth.signOut()`

Handle the `auth:required` custom event to show the sign-in prompt state.

**`src/js/theme.js`**
```javascript
const STORAGE_KEY = 'reader-theme';

export function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY) || '';
    applyTheme(saved);
    bindThemeDots();
}

export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    // Update active dot
    document.querySelectorAll('.theme-dot').forEach(dot => {
        dot.classList.toggle('active', dot.dataset.theme === theme);
    });
}

function bindThemeDots() {
    document.querySelectorAll('.theme-dot').forEach(dot => {
        dot.addEventListener('click', () => applyTheme(dot.dataset.theme));
    });
}
```

**`src/js/toast.js`**
```javascript
let toastTimer = null;
let undoCallback = null;

export function showToast(message, type = 'info', onUndo = null) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMsg');
    const dot = document.getElementById('toastDot');
    const undoBtn = document.getElementById('toastUndo');

    msg.textContent = message;
    dot.className = `toast-dot ${type}`;
    undoBtn.style.display = onUndo ? '' : 'none';
    undoCallback = onUndo;

    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        undoCallback = null;
    }, 5000);
}

export function initToast() {
    document.getElementById('toastUndo')?.addEventListener('click', () => {
        if (undoCallback) {
            undoCallback();
            undoCallback = null;
        }
        clearTimeout(toastTimer);
        document.getElementById('toast').classList.remove('show');
    });
}
```

**`src/js/app.js`** — Router
```javascript
import { initTheme } from './theme.js';
import { initToast } from './toast.js';
import { supabase, getSession } from './supabase.js';

const views = {
    input: document.getElementById('inputView'),
    reader: document.getElementById('readerView'),
    library: document.getElementById('libraryView'),
    history: document.getElementById('historyView'),
};

function showView(name) {
    Object.values(views).forEach(v => v?.classList.add('hidden'));
    views[name]?.classList.remove('hidden');
    // Update nav active state
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.view === name);
    });
}

async function route() {
    const path = window.location.pathname;
    if (path === '/library') {
        const { renderLibrary } = await import('./library.js');
        showView('library');
        renderLibrary();
    } else if (path === '/history') {
        const { renderHistory } = await import('./history.js');
        showView('history');
        renderHistory();
    } else {
        showView('input');
    }
}

// Nav link clicks
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const view = link.dataset.view;
        const path = view === 'input' ? '/' : `/${view}`;
        history.pushState(null, '', path);
        route();
    });
});

window.addEventListener('popstate', route);

// Init
initTheme();
initToast();
route();
```

**`src/index.html`** — Full SPA shell
Build this by combining the header structure shared across mockups with view containers. Reference `mockup_library.html` for the header pattern (logo, nav, avatar, theme dots). Include:
- All 5 CSS files via `<link>` tags
- View containers: `#inputView`, `#readerView` (hidden), `#libraryView` (hidden), `#historyView` (hidden)
- Auth modal markup (from `mockup_auth.html`) — all 4 states
- Toast component markup
- `<script type="module" src="/js/app.js">`

### Header behavior
- **Logged out:** Show "Sign in" button (no Library/History nav, no avatar)
- **Logged in:** Show Library/History nav links, user avatar with initials, hide "Sign in" button

Listen to `supabase.auth.onAuthStateChange` to toggle between these states.

### Verify
```bash
npm run dev
# Visit http://localhost:5173
# → Should see input view with header
# → Click "Sign in" → auth modal opens
# → Create account via email → modal closes, header updates to show nav + avatar
# → Click Library → URL changes to /library, library view shows (empty for now)
# → Click History → URL changes to /history
# → Click theme dots → theme changes
# → Sign out → header reverts to sign-in button
```

---

## Phase 6: Frontend — Reader

### Goal
Flipbook reader working end-to-end: fetch URL → read → save → position auto-saves.

### Files to create

**`src/js/reader.js`**
Extract the flipbook engine from `design_v2.html`. Key adaptations:
- Convert from IIFE to ES module with exported functions
- `loadArticle(contentHtml, options)` — initializes flipbook with content, restores page/preferences if provided
- `getCurrentState()` — returns `{ currentPage, totalPages, fontSize, fontFamily, theme }`
- Wire URL input form to call `api.post('/api/fetch', { url })` instead of form submission
- Wire save button:
  1. Check if user is logged in (via `getSession()`)
  2. If logged in → `api.post('/api/articles', payload)` → toggle button to "Saved" state → show toast
  3. If logged out → store payload in `pendingSave` → show auth modal (sign-in prompt state)
  4. If already saved → `api.delete('/api/articles/${articleId}')` → toggle button back → show "Removed" toast

**Save button toggle behavior:**
```javascript
let currentArticleId = null; // null = not saved

function updateSaveButton() {
    const btn = document.getElementById('saveBtn');
    if (currentArticleId) {
        btn.classList.add('saved');
        btn.setAttribute('title', 'Remove from library');
    } else {
        btn.classList.remove('saved');
        btn.setAttribute('title', 'Save to library');
    }
}
```

**Page flip auto-save (for library articles):**
```javascript
let positionTimer = null;
let positionDirty = false;

function onPageFlip(page, total) {
    if (!currentArticleId) return;
    positionDirty = true;

    clearTimeout(positionTimer);
    positionTimer = setTimeout(() => {
        api.patch(`/api/articles/${currentArticleId}/position`, {
            current_page: page,
            total_pages: total,
        });
        positionDirty = false;
    }, 1500);
}

window.addEventListener('beforeunload', () => {
    if (currentArticleId && positionDirty) {
        const body = JSON.stringify({
            current_page: getCurrentPage(),
            total_pages: getTotalPages(),
        });
        navigator.sendBeacon(
            `/api/articles/${currentArticleId}/position`,
            new Blob([body], { type: 'application/json' })
        );
    }
});
```

**History auto-logging (for all articles, when user is signed in):**
```javascript
import { getSession } from './supabase.js';
import { api } from './api.js';

async function logToHistory(title, sourceUrl, contentHtml, currentPage, totalPages) {
    const session = await getSession();
    if (!session) return; // Don't log for anonymous users

    // SHA-256 hash of content for dedup
    const encoder = new TextEncoder();
    const data = encoder.encode(contentHtml);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const domain = sourceUrl ? new URL(sourceUrl).hostname.replace('www.', '') : null;

    api.post('/api/history', {
        title,
        source_url: sourceUrl,
        content_html: contentHtml,
        content_hash: contentHash,
        current_page: currentPage,
        total_pages: totalPages,
    }).catch(console.error); // Fire and forget
}
```

### Collection picker on save
When the user clicks save, show a small dropdown below the save button listing their collections (fetched from `GET /api/collections`). Default selection is "Uncategorized" (null). User picks one → collection_id is included in the POST payload.

Implementation: A small popover component that appears on save click. If user just clicks save without picking, it saves to Uncategorized immediately. A small "v" arrow next to the save button opens the collection picker.

### Verify
```bash
npm run dev  # + flask run in another terminal

# 1. Enter a URL → click Read → article loads in flipbook
# 2. Flip pages → check Flask logs for position save requests (after 1.5s debounce)
# 3. Click save → article saved, toast shows "Saved to library"
# 4. Click save again → removed, toast shows "Removed from library"
# 5. When logged out, click save → auth prompt appears
# 6. After signing in → article auto-saves (pendingSave pattern)
```

---

## Phase 7: Frontend — Library + History

### Goal
Library and History pages fully functional with live data.

### Library (src/js/library.js)

**Render cards from API data:**
```javascript
export async function renderLibrary() {
    const data = await api.get('/api/articles?sort=' + currentSort);
    const container = document.getElementById('cardsGrid');

    if (data.articles.length === 0) {
        showEmptyState();
        return;
    }

    container.innerHTML = data.articles.map(article => renderCard(article)).join('');
    bindCardEvents();
}
```

**Card rendering — data mapping from API to HTML:**
- Title: `article.title`
- Domain + favicon: `article.source_domain` → render as `<img src="https://www.google.com/s2/favicons?domain=${article.source_domain}&sz=16">` + domain text
- Collection badge: if `article.collection_id`, show collection name and color
- Progress bar: `width: ${(article.current_page / article.total_pages * 100)}%`
- Progress text: `Page ${article.current_page} of ${article.total_pages}`
- Reading time: `${Math.max(1, Math.round(article.word_count / 225))} min read`
- Last read: format `article.last_read_at` as relative time ("3 hours ago", "Yesterday")
- Date saved: format `article.saved_at` as relative time

**Relative time formatting:**
```javascript
function relativeTime(dateString) {
    if (!dateString) return 'Never';
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 172800) return 'Yesterday';
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)} weeks ago`;
    return date.toLocaleDateString();
}
```

**Sort dropdown:**
Wire the 3 sort options (Last read, Date saved, Progress). On change, re-fetch with updated `?sort=` param. Persist via `PATCH /api/user/preferences`.

**Collection filter:**
Sidebar shows collections (from `GET /api/collections`). Clicking a collection re-fetches with `?collection_id=`. "All articles" clears the filter. "Uncategorized" filters with `?collection_id=uncategorized`.

**Remove + Undo (deferred delete pattern):**
On remove click:
1. Animate card out (CSS transition), remove from DOM
2. Store article data in memory + start 5-second timer
3. Show toast "Article removed" with Undo button
4. On Undo: re-insert card into DOM, cancel the timer, show "Restored" toast
5. On toast dismiss (5s): fire `DELETE /api/articles/:id` for real

This deferred approach preserves the article's original ID and keeps `history_entries.article_id` intact if the user undoes. The actual DELETE only fires after the undo window closes.

**"Move to..." context menu on library cards:**
Each card's three-dot menu has a "Move to..." option. Clicking it shows a submenu of collections. Selecting one calls `PATCH /api/articles/:id` with the new `collection_id`. Update the card's collection badge without full re-render.

**Opening an article from library:**
Click a card → fetch `GET /api/articles/:id` → load in reader at `current_page` with stored preferences (font_size, font_family, theme) → navigate to reader view.

### History (src/js/history.js)

**Render entries grouped by date:**
```javascript
export async function renderHistory() {
    const data = await api.get('/api/history');

    if (data.entries.length === 0) {
        showEmptyState();
        return;
    }

    const groups = groupByDate(data.entries);
    const container = document.getElementById('historyList');
    container.innerHTML = groups.map(group => renderDateGroup(group)).join('');
    bindEntryEvents();
}

function groupByDate(entries) {
    const groups = {};
    for (const entry of entries) {
        const date = new Date(entry.opened_at);
        const key = isToday(date) ? 'Today'
                  : isYesterday(date) ? 'Yesterday'
                  : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        if (!groups[key]) groups[key] = [];
        groups[key].push(entry);
    }
    return Object.entries(groups).map(([label, entries]) => ({ label, entries }));
}
```

**Entry rendering:**
- Title: `entry.title`
- Domain: `entry.source_domain` with favicon (same Google favicon approach)
- Progress: `Page ${entry.current_page} of ${entry.total_pages}` or "Finished" if current_page >= total_pages
- Time: relative time from `entry.opened_at`

**Opening from history:**
Click entry → fetch `GET /api/history/:id` (includes content_html) → if `entry.article_id` exists, load via library article endpoint instead. Load in reader at stored page.

**Delete entry + Undo:**
Same pattern as library remove: animate out, DELETE, toast with undo.

**Clear all:**
Show confirmation dialog → on confirm → `DELETE /api/history` → show empty state → toast "History cleared".

### Verify
```bash
# Full end-to-end:
# 1. Fetch an article via URL → read a few pages → save it
# 2. Navigate to Library → article appears with correct title, domain, progress, timestamps
# 3. Navigate to History → article appears (was auto-logged on open)
# 4. Change sort → order updates
# 5. Create collection → move article → filter by collection → article shows
# 6. Remove article → undo works → article returns
# 7. Click article in library → opens at correct page with preferences
# 8. Open an article WITHOUT saving → appears in History only
# 9. Click history entry → article re-opens at last page
```

---

## Phase 8: Deploy to Railway

### Goal
App running at a public Railway URL with Supabase backend.

### Steps

1. **Ensure everything is committed to GitHub**
   ```bash
   git add -A
   git commit -m "V1: complete reader app"
   git push origin main
   ```

2. **Create Railway project**
   - Go to https://railway.app → New Project → Deploy from GitHub repo
   - Select `reader-app` repository

3. **Set environment variables in Railway**
   - `DATABASE_URL` — Supabase connection string
   - `SUPABASE_URL` — Supabase project URL
   - `SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key
   - `FLASK_ENV` — `production`
   - `VITE_SUPABASE_URL` — same as SUPABASE_URL (needed at build time)
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — same as SUPABASE_PUBLISHABLE_KEY (needed at build time)

4. **Configure Railway**
   - Railway auto-detects Docker and uses the Dockerfile
   - Set the PORT environment variable if needed (Railway provides it)
   - Update Dockerfile CMD: `CMD gunicorn --bind 0.0.0.0:${PORT:-5000} reader_app:app`

5. **Update Supabase OAuth redirect URLs**
   - Go to Supabase Dashboard → Authentication → URL Configuration
   - Add Railway URL to Redirect URLs: `https://your-app.railway.app/**`
   - Update Site URL to Railway URL

6. **Run migrations on production**
   ```bash
   # Railway CLI or via Railway shell
   flask db upgrade
   ```

### Verify
```
# Visit your Railway URL
# 1. Sign up with email → verify redirect works
# 2. Sign in with Google → OAuth flow completes
# 3. Fetch an article → read → save → check library
# 4. Sign in on different device → library and history sync
# 5. Verify all flows from the PRD verification criteria
```

---

## Testing

### `tests/conftest.py`
```python
import pytest
from app import create_app
from app.extensions import db as _db
from app.config import TestConfig

@pytest.fixture
def app():
    app = create_app()
    app.config.from_object(TestConfig)
    with app.app_context():
        _db.create_all()
        yield app
        _db.session.remove()
        _db.drop_all()

@pytest.fixture
def client(app):
    return app.test_client()
```

### Test strategy
- Unit tests for each API endpoint (mock JWT validation in tests)
- Test CRUD operations for articles, collections, history
- Test sort ordering
- Test cascade behavior (delete collection → articles become uncategorized)
- Test history upsert (same content_hash updates instead of duplicating)

---

## Verification Checklist (from PRD)

- [ ] Create account → sign in → sign out → sign in again (both email and OAuth)
- [ ] Save an article → appears in library with correct title, domain, progress
- [ ] Read several pages → close and reopen → library shows updated progress
- [ ] Click article in library → opens at correct page with correct preferences
- [ ] Assign article to collection → filter library by collection → article appears
- [ ] Open article without saving → appears in History → clickable to resume
- [ ] Remove article from library → undo toast works → article gone but still in history
- [ ] Sort by each option → order changes correctly
- [ ] Sign in on second browser → library and history match
- [ ] Estimated reading time shows reasonable values (5-min article ~ 1000-1250 words)
