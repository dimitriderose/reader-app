# Technical Design: Reader App V1

## Overview

The reader app has a working flipbook frontend (docs/design_v2.html) and a minimal Flask backend (reader_app.py) with zero persistence. V1 adds user accounts, a library for saved articles, reading history, collections, and multi-device sync — backed by Supabase (auth + PostgreSQL) and deployed on Railway.

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Flask | Already in use; keep building on it |
| ORM | SQLAlchemy + Flask-Migrate (Alembic) | Standard Flask ORM with schema migrations |
| Database | Supabase PostgreSQL | Free tier (500 MB), managed, same service as auth |
| Auth | Supabase Auth | Free tier (50K MAU); handles email/password, Google/GitHub OAuth, password reset emails — zero auth code on our backend |
| Frontend Build | Vite | Fast bundler, HMR in dev, minified output for prod |
| Frontend | Vanilla JS (ES modules) | No framework — extract existing mockup code into modules |
| Deployment | Railway + Docker | Free tier ($5/mo credit), deploy from GitHub |

### What Supabase Auth eliminates

We do NOT build: password hashing, OAuth redirect flows, password reset email sending, session management, email service integration, or a password_reset_tokens table. Supabase handles all of this.

## Authentication Flow

1. Frontend uses @supabase/supabase-js to handle sign-up, sign-in, OAuth, and password reset
2. Supabase returns a JWT (access_token) signed with an asymmetric key (ES256)
3. Frontend sends Authorization: Bearer <token> with all API requests
4. Flask middleware validates the JWT using Supabase's JWKS (public keys fetched from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
5. User ID is extracted from the token's sub claim — no server-side sessions needed
6. On first authenticated request, Flask auto-creates a user_profiles row

Note: Supabase has migrated from symmetric JWT secrets (HS256) to asymmetric JWT Signing Keys (ES256). We use the JWKS endpoint for verification — no shared secret needed on our backend.

### Post-Signup Auto-Save (Flow A)

When a logged-out user clicks save, the auth modal opens. After successful sign-up/sign-in, the pending save executes automatically:

1. User clicks save → frontend stores pendingSave = { title, content, page, ... } in memory
2. Auth modal opens (sign-in prompt state)
3. On Supabase onAuthStateChange firing SIGNED_IN, check pendingSave
4. If pendingSave exists → POST /api/articles → clear pendingSave → show "Saved to library" toast

Ownership: src/js/auth.js (stores intent) + src/js/supabase.js (executes on auth change)

## Database Schema

4 tables. All primary keys are UUID v4. All timestamps are UTC.

### user_profiles

Links to Supabase Auth's auth.users. Auto-created on first API call.

| Column | Type | Constraints |
|--------|------|------------|
| id | UUID | PK, matches Supabase auth.users.id |
| display_name | VARCHAR(100) | NOT NULL |
| avatar_url | VARCHAR(500) | NULLABLE |
| sort_preference | VARCHAR(20) | DEFAULT 'lastread' |
| created_at | TIMESTAMP | NOT NULL |
| updated_at | TIMESTAMP | NOT NULL |

### collections

| Column | Type | Constraints |
|--------|------|------------|
| id | UUID | PK |
| user_id | UUID | FK → user_profiles.id, NOT NULL |
| name | VARCHAR(100) | NOT NULL |
| color | VARCHAR(20) | DEFAULT 'blue' |
| position | INTEGER | DEFAULT 0 |
| created_at | TIMESTAMP | NOT NULL |

Index: UNIQUE(user_id, name)

### articles

| Column | Type | Constraints |
|--------|------|------------|
| id | UUID | PK |
| user_id | UUID | FK → user_profiles.id, NOT NULL |
| collection_id | UUID | FK → collections.id, NULLABLE (NULL = Uncategorized) |
| title | VARCHAR(500) | NOT NULL |
| source_url | VARCHAR(2000) | NULLABLE |
| source_domain | VARCHAR(200) | NULLABLE |
| content_html | TEXT | NOT NULL |
| word_count | INTEGER | DEFAULT 0 |
| current_page | INTEGER | DEFAULT 1 |
| total_pages | INTEGER | DEFAULT 1 |
| font_size | INTEGER | DEFAULT 20 |
| font_family | VARCHAR(50) | DEFAULT 'serif' |
| theme | VARCHAR(10) | DEFAULT 'light' |
| last_read_at | TIMESTAMP | NULLABLE |
| saved_at | TIMESTAMP | NOT NULL |

Indexes: (user_id, last_read_at DESC), (user_id, saved_at DESC), (user_id, collection_id)

### history_entries

| Column | Type | Constraints |
|--------|------|------------|
| id | UUID | PK |
| user_id | UUID | FK → user_profiles.id, NOT NULL |
| article_id | UUID | FK → articles.id, NULLABLE, ON DELETE SET NULL |
| title | VARCHAR(500) | NOT NULL (denormalized — survives article deletion) |
| source_url | VARCHAR(2000) | NULLABLE |
| source_domain | VARCHAR(200) | NULLABLE |
| content_html | TEXT | NOT NULL (needed to re-open non-library articles) |
| current_page | INTEGER | DEFAULT 1 |
| total_pages | INTEGER | DEFAULT 1 |
| content_hash | VARCHAR(64) | NOT NULL (SHA-256 of content_html, for dedup) |
| opened_at | TIMESTAMP | NOT NULL |

Index: UNIQUE(user_id, content_hash) — upsert on re-open

### Key relationships

- Deleting a collection sets articles.collection_id to NULL (moves to Uncategorized)
- Deleting an article sets history_entries.article_id to NULL (history survives)
- history_entries stores full content_html so articles can be re-opened from history even if not saved to library

## API Endpoints

All under /api. Auth required unless noted. JWT validated via middleware.

### Articles (Library)

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| GET | /api/articles | List library (no content_html) | Query: ?sort=lastread\|saved\|progress&collection_id=&lt;uuid&gt;\|uncategorized | { articles: [{ id, title, source_url, source_domain, word_count, current_page, total_pages, font_size, font_family, theme, collection_id, last_read_at, saved_at }] } |
| POST | /api/articles | Save to library | { title, source_url, content_html, current_page, total_pages, font_size, font_family, theme, collection_id? } | { article: { id, ... } } 201 |
| GET | /api/articles/:id | Get article with content | — | { article: { id, ..., content_html } } |
| PATCH | /api/articles/:id | Update metadata | { collection_id?, font_size?, font_family?, theme? } | { article: { ... } } |
| PATCH | /api/articles/:id/position | Auto-save position | { current_page, total_pages } | { ok: true } |
| DELETE | /api/articles/:id | Remove from library | — | { ok: true } |

### Collections

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| GET | /api/collections | List with counts | — | { collections: [{ id, name, color, position, article_count }] } |
| POST | /api/collections | Create | { name, color? } | { collection: { ... } } 201 |
| PATCH | /api/collections/:id | Rename/recolor | { name?, color?, position? } | { collection: { ... } } |
| DELETE | /api/collections/:id | Delete (articles → Uncategorized) | — | { ok: true } |

### History

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| GET | /api/history | List entries (no content) | — | { entries: [{ id, title, source_domain, current_page, total_pages, article_id, opened_at }] } |
| GET | /api/history/:id | Get entry with content | — | { entry: { id, ..., content_html } } |
| POST | /api/history | Log article open (upsert) | { title, source_url, content_html, content_hash, current_page, total_pages } | { entry: { id, ... } } |
| PATCH | /api/history/:id/position | Update position | { current_page, total_pages } | { ok: true } |
| DELETE | /api/history/:id | Remove single entry | — | { ok: true } |
| DELETE | /api/history | Clear all | — | { ok: true } |

### Content

| Method | Path | Auth | Purpose | Request Body | Response |
|--------|------|------|---------|-------------|----------|
| POST | /api/fetch | Optional | Fetch & parse URL | { url } | { title, content_html, word_count, source_domain } |

### User

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| GET | /api/user/profile | Get profile | — | { profile: { display_name, email, avatar_url, sort_preference } } |
| PATCH | /api/user/preferences | Update sort pref | { sort_preference } | { ok: true } |

Note: Email is extracted from the JWT claims, not stored in user_profiles.

Note: `word_count` is not sent by the client — it is computed server-side from `content_html` on save.

### Error Responses

All error responses use a consistent format:

```json
{ "error": "Human-readable error message" }
```

Common HTTP status codes:
- `400` — Bad request (missing/invalid fields)
- `401` — Missing or invalid JWT
- `404` — Resource not found (or doesn't belong to user)
- `422` — Unprocessable (e.g., URL fetch failed)

## Project Structure

```
reader-app/
├── app/                          # Flask backend
│   ├── __init__.py               # App factory: create_app()
│   ├── config.py                 # Dev/Prod/Test config classes
│   ├── extensions.py             # db, migrate — initialized without app
│   ├── middleware/
│   │   └── auth.py               # JWT validation decorator
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user_profile.py
│   │   ├── article.py
│   │   ├── collection.py
│   │   └── history.py
│   ├── api/
│   │   ├── __init__.py           # Blueprint registration
│   │   ├── articles.py
│   │   ├── collections.py
│   │   ├── history.py
│   │   ├── fetch.py
│   │   └── user.py
│   └── services/
│       ├── scraper.py            # Refactored from reader_app.py
│       └── word_count.py         # HTML → word count → reading time
├── src/                          # Frontend source (Vite)
│   ├── js/
│   │   ├── app.js                # Client-side router, view lifecycle
│   │   ├── api.js                # fetch() wrappers, JWT injection, 401 handling
│   │   ├── supabase.js           # Supabase client init, auth state listener
│   │   ├── reader.js             # Flipbook engine (from design_v2.html)
│   │   ├── library.js            # Library rendering, sort, filter, remove+undo
│   │   ├── history.js            # History rendering, delete, clear-all
│   │   ├── auth.js               # Auth modal, form validation, Supabase auth calls
│   │   ├── theme.js              # Theme system (shared)
│   │   └── toast.js              # Toast notifications (shared)
│   ├── css/
│   │   ├── base.css              # CSS variables, header, shared components
│   │   ├── reader.css            # Flipbook, toolbar, bottom bar
│   │   ├── library.css           # Sidebar, cards, sort dropdown
│   │   ├── history.css           # Date groups, entries, progress rings
│   │   └── auth.css              # Modal, forms, OAuth buttons
│   └── index.html                # SPA shell (Vite entry point)
├── docs/                         # Design references
├── migrations/                   # Alembic (auto-generated)
├── tests/
│   ├── conftest.py
│   ├── test_articles.py
│   ├── test_collections.py
│   └── test_history.py
├── reader_app.py                 # Legacy → imports create_app()
├── webscraper.py                 # Standalone CLI (preserved)
├── vite.config.js
├── package.json
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

## Frontend Architecture

### SPA Shell (src/index.html)

Single HTML file containing:
- Shared header: logo, nav (Library / History), theme dots, avatar or sign-in button
- View containers: #inputView, #readerView, #libraryView, #historyView
- Auth modal (always in DOM, hidden by default)
- Toast notification component

### Client-Side Router (src/js/app.js)

```
/          → inputView (or readerView if article loaded)
/library   → libraryView
/history   → historyView
```

Uses history.pushState(). Flask serves index.html for all non-API routes (catch-all).

### Module Responsibilities

| Module | Responsibility |
|--------|---------------|
| app.js | Router, view lifecycle (mount/unmount), nav active state |
| api.js | fetch() wrapper; injects Authorization header; handles 401 → redirect to sign-in |
| supabase.js | Supabase client init; onAuthStateChange listener; pendingSave execution |
| reader.js | Flipbook engine: CSS column pagination, page flip, toolbar, save button |
| library.js | Fetch articles from API, render cards, sort dropdown, collection filter, remove + undo toast |
| history.js | Fetch history from API, render date-grouped entries, delete entries, clear all |
| auth.js | Auth modal state machine (sign-in, register, forgot, prompt); Supabase auth calls |
| theme.js | Light/Sepia/Dark via CSS custom properties; persists to localStorage |
| toast.js | Show/hide toast with type (info/success/error), optional undo button, auto-dismiss |

### Vite Configuration

- Dev: Vite dev server on :5173 proxies /api/* to Flask on :5000
- Prod: Vite builds to app/static/dist/; Flask serves the built index.html and assets

### Mockup Decomposition

Each mockup HTML file is decomposed into its JS module + CSS file:
- docs/design_v2.html → src/js/reader.js + src/css/reader.css
- docs/mockup_auth.html → src/js/auth.js + src/css/auth.css
- docs/mockup_library.html → src/js/library.js + src/css/library.css
- docs/mockup_history.html → src/js/history.js + src/css/history.css

Library and History views render dynamically from API JSON responses (not static HTML).

## Reading Position Auto-Save

Triggered on every page flip for articles saved to the library.

**Strategy:** Debounced 1.5s after last flip + sendBeacon on tab close.

```javascript
let positionTimer = null;

function onPageFlip() {
    if (articleId) {
        clearTimeout(positionTimer);
        positionTimer = setTimeout(() => {
            api.patch(`/api/articles/${articleId}/position`, {
                current_page: currentPage + 1,
                total_pages: totalPages
            });
        }, 1500);
    }
}

window.addEventListener('beforeunload', () => {
    if (articleId && positionDirty) {
        const body = JSON.stringify({
            current_page: currentPage + 1,
            total_pages: totalPages
        });
        navigator.sendBeacon(
            `/api/articles/${articleId}/position`,
            new Blob([body], { type: 'application/json' })
        );
    }
});
```

Note: sendBeacon requires a Blob with Content-Type for Flask to parse JSON correctly.

## Configuration

```python
# app/config.py
import os

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
```

### Environment Variables (.env.example)

```
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJ...
FLASK_ENV=development
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...
```

Note: `VITE_` prefixed variables are needed at frontend build time (Vite injects them via `import.meta.env`).

Note: No `SUPABASE_JWT_SECRET` is needed — JWT verification uses the public JWKS endpoint at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` (asymmetric ES256 signing).

## Design References

- Product Requirements: docs/product_requirements_v1.md
- Reader UI: docs/design_v2.html
- Auth Modal: docs/mockup_auth.html
- Library Page: docs/mockup_library.html
- History Page: docs/mockup_history.html
