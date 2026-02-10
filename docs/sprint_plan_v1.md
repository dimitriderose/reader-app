# Sprint Plan: Reader App V1

## Overview

Build the V1 reader app in 4 sprints. Each sprint produces a working, testable increment. The implementation follows the 8 phases defined in `docs/implementation_v1.md` but groups them into shippable units.

Reference docs:
- PRD: `docs/product_requirements_v1.md`
- Technical Design: `docs/technical_design_v1.md`
- Implementation Guide: `docs/implementation_v1.md`
- Mistakes to Avoid: `docs/mistakes_log.md`

---

## Sprint 1 — Foundation (Phases 1-3)

**Goal:** Flask app factory running, database tables created in Supabase, JWT auth middleware protecting endpoints, user profile auto-creation working.

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 1.1 | Create directory structure | `app/`, `src/`, `tests/`, etc. | All folders from project structure |
| 1.2 | Write `requirements.txt` | `requirements.txt` | flask, sqlalchemy, migrate, cors, pyjwt, etc. |
| 1.3 | Write app factory | `app/__init__.py` | `create_app()`, CORS, blueprint registration, SPA catch-all |
| 1.4 | Write config | `app/config.py` | Dev/Prod/Test configs, `os.environ.get()` style (see M8) |
| 1.5 | Write extensions | `app/extensions.py` | `db`, `migrate` |
| 1.6 | Write 4 SQLAlchemy models | `app/models/*.py` | user_profile, article, collection, history — watch M2 (index columns), M10 (VARCHAR sizes) |
| 1.7 | Create blueprint stubs | `app/api/*.py` | Empty blueprints for articles, collections, history, fetch, user |
| 1.8 | Write JWT auth middleware | `app/middleware/auth.py` | `require_auth`, `optional_auth` decorators — don't forget `__init__.py` (M7) |
| 1.9 | Write user endpoints | `app/api/user.py` | GET profile (email from JWT, M9), PATCH preferences |
| 1.10 | Extract scraper into service | `app/services/scraper.py` | Extract from `reader_app.py` BEFORE overwriting it (M11) |
| 1.11 | Write word count service | `app/services/word_count.py` | `count_words()`, `reading_time_minutes()` |
| 1.12 | Update entry point | `reader_app.py` | 2-line app factory import (after 1.10) |
| 1.13 | Write Vite config | `package.json`, `vite.config.js` | Dev proxy to Flask :5000 |
| 1.14 | Write minimal frontend shell | `src/index.html`, `src/js/app.js` | Just "scaffold working" placeholder |
| 1.15 | Write Docker files | `Dockerfile`, `docker-compose.yml` | Multi-stage build, shell form CMD (M1, M4) |
| 1.16 | Write env template | `.env.example` | Include VITE_ vars |
| 1.17 | Update `.gitignore` | `.gitignore` | Add node_modules, dist, .env |

### Verification
- `pip install -r requirements.txt` succeeds
- `flask run` starts without errors
- `npm install && npm run dev` starts Vite dev server
- `flask db init && flask db migrate && flask db upgrade` creates 4 tables
- `curl /api/user/profile` with valid JWT returns profile JSON
- `curl /api/user/profile` without JWT returns 401

### Dependencies
- Supabase project must be created and credentials obtained before 1.6

### Risk
- Supabase connection string issues (IPv6, SSL mode) — test early

---

## Sprint 2 — Core API (Phase 4)

**Goal:** All REST endpoints working end-to-end. Full CRUD for articles, collections, history. URL fetch endpoint. Testable via curl.

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 2.1 | Implement fetch endpoint | `app/api/fetch.py` | Uses scraper service, returns `{ title, content_html, word_count, source_domain }` |
| 2.2 | Implement articles CRUD | `app/api/articles.py` | 6 endpoints — server computes word_count (M9), handle sendBeacon JSON parsing |
| 2.3 | Implement collections CRUD | `app/api/collections.py` | 4 endpoints — article count subquery, cascade NULL on delete |
| 2.4 | Implement history CRUD | `app/api/history.py` | 6 endpoints — upsert on content_hash, GET /:id returns content_html |
| 2.5 | Write API tests | `tests/conftest.py`, `tests/test_articles.py`, `tests/test_collections.py`, `tests/test_history.py` | Mock JWT in tests, test cascades, test sort orders |

### Verification
- All curl commands from implementation doc Phase 4 pass
- Save article → list shows it (without content_html)
- Update position → re-fetch shows updated page
- Create collection → move article → filter → article appears
- History upsert: POST same content_hash twice → single entry, updated timestamp
- Delete collection → articles become uncategorized
- Delete article → history entry's article_id becomes NULL
- Tests pass: `pytest tests/`

### Dependencies
- Sprint 1 complete (models, auth middleware, scraper service)

### Risk
- Sort by "progress" requires computed column ordering — test with real data
- sendBeacon content-type parsing edge case — test manually

---

## Sprint 3 — Frontend (Phases 5-7)

**Goal:** Full SPA working — auth modal, reader with save/position-sync, library with sort/filter/undo, history with delete/clear. All wired to live API.

This is the largest sprint. The 4 mockup HTML files are the source material.

### Tasks

| # | Task | Files | Source Mockup | Complexity |
|---|------|-------|---------------|------------|
| 3.1 | Extract shared CSS | `src/css/base.css` | All 4 mockups | Low |
| 3.2 | Build SPA shell | `src/index.html` | Combine headers from mockups | Medium |
| 3.3 | Write Supabase client | `src/js/supabase.js` | New | Medium |
| 3.4 | Write API wrapper | `src/js/api.js` | New | Low |
| 3.5 | Write theme module | `src/js/theme.js` | All mockups (shared pattern) | Low |
| 3.6 | Write toast module | `src/js/toast.js` | Library + History mockups | Low |
| 3.7 | Write router | `src/js/app.js` | New | Medium |
| 3.8 | Build auth modal | `src/js/auth.js`, `src/css/auth.css` | `mockup_auth.html` (1341 lines) | High |
| 3.9 | Build reader | `src/js/reader.js`, `src/css/reader.css` | `design_v2.html` (1397 lines) | High |
| 3.10 | Wire save button | Part of `reader.js` | New (pendingSave + toggle) | Medium |
| 3.11 | Wire position auto-save | Part of `reader.js` | New (debounce + sendBeacon) | Medium |
| 3.12 | Wire history auto-log | Part of `reader.js` | New (Web Crypto SHA-256, M3) | Low |
| 3.13 | Build library page | `src/js/library.js`, `src/css/library.css` | `mockup_library.html` (1626 lines) | High |
| 3.14 | Build history page | `src/js/history.js`, `src/css/history.css` | `mockup_history.html` (1426 lines) | Medium |

### Build Order (dependency-driven)

```
3.1 base.css
 ├── 3.5 theme.js        (needs CSS vars)
 ├── 3.6 toast.js         (needs base styles)
 └── 3.2 index.html       (needs base.css)
      ├── 3.3 supabase.js (standalone)
      ├── 3.4 api.js       (needs supabase.js)
      ├── 3.7 app.js       (needs all views)
      ├── 3.8 auth.js      (needs supabase.js, api.js, toast.js)
      ├── 3.9 reader.js    (needs api.js, toast.js)
      │    ├── 3.10 save button  (needs auth.js, supabase.js)
      │    ├── 3.11 position     (needs api.js)
      │    └── 3.12 history log  (needs api.js, supabase.js)
      ├── 3.13 library.js  (needs api.js, toast.js)
      └── 3.14 history.js  (needs api.js, toast.js)
```

### Parallelization opportunity
- 3.1 + 3.3 + 3.4 + 3.5 + 3.6 can be built simultaneously (no interdependencies)
- 3.8 (auth) and 3.9 (reader) can be built in parallel after shared modules are done
- 3.13 (library) and 3.14 (history) can be built in parallel after shared modules are done

### Verification
- Sign up with email → modal closes, header shows avatar + nav
- Sign in with Google/GitHub → works
- Sign out → header reverts
- Enter URL → read article → save → toast → library shows it
- Page flip → position auto-saves (check network tab for debounced PATCH)
- Close tab → reopen → library shows correct page
- Sort by last read / date saved / progress → order changes
- Filter by collection → correct subset
- Remove article → undo → article returns
- History shows all opened articles → click reopens at saved page
- Clear history → confirmation → empty state
- Logged out user clicks save → auth modal → sign up → article auto-saves (Flow A)
- Theme switching works globally
- All 3 routes work: `/`, `/library`, `/history` + browser back/forward

### Dependencies
- Sprint 2 complete (all API endpoints working)
- Supabase Auth providers configured (Google, GitHub)

### Risk
- Flipbook extraction is the hardest task (1397 lines of tightly coupled DOM/CSS logic)
- Auth modal has 4 states + form validation — easy to break transitions
- Library deferred delete undo (M5) needs careful implementation

---

## Sprint 4 — Deploy + Polish (Phase 8)

**Goal:** App running at public Railway URL. All PRD verification criteria passing.

### Tasks

| # | Task | Notes |
|---|------|-------|
| 4.1 | Commit all work to GitHub | Clean commit history |
| 4.2 | Create Railway project | Connect to GitHub repo |
| 4.3 | Set Railway environment variables | All 7 env vars including VITE_ |
| 4.4 | Run production migration | `flask db upgrade` on Railway |
| 4.5 | Configure Supabase OAuth URLs | Add Railway URL as redirect |
| 4.6 | End-to-end testing on production | All 10 PRD verification criteria |
| 4.7 | Fix production-only issues | CORS, HTTPS redirects, etc. |

### Verification (PRD Checklist)
- [ ] Create account → sign in → sign out → sign in again (email + OAuth)
- [ ] Save article → appears in library with title, domain, progress
- [ ] Read pages → close → reopen → library shows updated progress
- [ ] Click library article → opens at correct page with preferences
- [ ] Assign to collection → filter → article appears
- [ ] Open without saving → appears in History → clickable to resume
- [ ] Remove from library → undo works → gone but still in history
- [ ] Sort by each option → order changes correctly
- [ ] Sign in on second browser → library and history match
- [ ] Reading time shows reasonable values (~225 WPM)

### Dependencies
- Sprint 3 complete
- Railway account ready

### Risk
- Docker build may fail on Railway (different build environment)
- Supabase free tier connection limits under load

---

## Feature Branches

8 branches, merged sequentially into `main`. Each branch is a self-contained, reviewable unit. Tasks 1.16 and 1.17 are already complete (committed in initial commit).

### Merge Order

```
main ← feature/project-scaffold
     ← feature/database-and-auth
     ← feature/api-endpoints
     ← feature/frontend-foundation
     ← feature/frontend-auth
     ← feature/frontend-reader
     ← feature/frontend-library-history
     ← feature/deploy
```

---

### Branch 1: `feature/project-scaffold`

**Sprint 1 tasks** — Directory structure, dependencies, app factory, config, extensions, services, entry point, Vite, frontend shell, Docker.

| Task | Description | Files |
|------|-------------|-------|
| 1.1 | Create directory structure | `app/`, `src/`, `tests/`, etc. |
| 1.2 | Write `requirements.txt` | `requirements.txt` |
| 1.3 | Write app factory | `app/__init__.py` |
| 1.4 | Write config | `app/config.py` |
| 1.5 | Write extensions | `app/extensions.py` |
| 1.10 | Extract scraper into service | `app/services/scraper.py` (from `reader_app.py` — M13) |
| 1.11 | Write word count service | `app/services/word_count.py` |
| 1.12 | Update entry point | `reader_app.py` (after 1.10) |
| 1.13 | Write Vite config | `package.json`, `vite.config.js` |
| 1.14 | Write minimal frontend shell | `src/index.html`, `src/js/app.js` |
| 1.15 | Write Docker files | `Dockerfile`, `docker-compose.yml` |

**Verify:** `pip install` succeeds, `flask run` starts, `npm run dev` starts Vite.

---

### Branch 2: `feature/database-and-auth`

**Sprint 1 tasks** — SQLAlchemy models, migrations, blueprint stubs, JWT middleware, user endpoints.

| Task | Description | Files |
|------|-------------|-------|
| 1.6 | Write 4 SQLAlchemy models | `app/models/*.py` (M2, M11) |
| 1.7 | Create blueprint stubs | `app/api/*.py` |
| 1.8 | Write JWT auth middleware | `app/middleware/auth.py` (M7 — `__init__.py`) |
| 1.9 | Write user endpoints | `app/api/user.py` |

**Verify:** `flask db migrate && flask db upgrade` creates 4 tables. `curl /api/user/profile` with JWT returns profile, without JWT returns 401.

---

### Branch 3: `feature/api-endpoints`

**Sprint 2 tasks** — All CRUD endpoints + tests.

| Task | Description | Files |
|------|-------------|-------|
| 2.1 | Implement fetch endpoint | `app/api/fetch.py` |
| 2.2 | Implement articles CRUD | `app/api/articles.py` (6 endpoints, M9) |
| 2.3 | Implement collections CRUD | `app/api/collections.py` (4 endpoints) |
| 2.4 | Implement history CRUD | `app/api/history.py` (6 endpoints, upsert) |
| 2.5 | Write API tests | `tests/conftest.py`, `tests/test_*.py` |

**Verify:** All curl commands pass. Save → list → update → delete flows work. Cascades work (delete collection → articles uncategorized, delete article → history.article_id NULL). `pytest tests/` passes.

---

### Branch 4: `feature/frontend-foundation`

**Sprint 3 tasks** — Shared CSS, SPA shell, Supabase client, API wrapper, theme, toast, router.

| Task | Description | Files | Source |
|------|-------------|-------|--------|
| 3.1 | Extract shared CSS | `src/css/base.css` | All 4 mockups |
| 3.2 | Build SPA shell | `src/index.html` | Combine mockup headers |
| 3.3 | Write Supabase client | `src/js/supabase.js` | New |
| 3.4 | Write API wrapper | `src/js/api.js` | New |
| 3.5 | Write theme module | `src/js/theme.js` | All mockups |
| 3.6 | Write toast module | `src/js/toast.js` | Library + History mockups |
| 3.7 | Write router | `src/js/app.js` | New |

**Verify:** Vite dev server renders SPA shell. Router navigates between `/`, `/library`, `/history`. Theme switching works. Toast displays.

---

### Branch 5: `feature/frontend-auth`

**Sprint 3 task** — Auth modal with all 4 states, wired to Supabase Auth.

| Task | Description | Files | Source |
|------|-------------|-------|--------|
| 3.8 | Build auth modal | `src/js/auth.js`, `src/css/auth.css` | `mockup_auth.html` (1341 lines) |

**Verify:** Sign up with email, sign in, sign out, forgot password flow, Google/GitHub OAuth. Header updates on auth state change.

---

### Branch 6: `feature/frontend-reader`

**Sprint 3 tasks** — Flipbook engine, save button, position sync, history auto-logging.

| Task | Description | Files | Source |
|------|-------------|-------|--------|
| 3.9 | Build reader (flipbook) | `src/js/reader.js`, `src/css/reader.css` | `design_v2.html` (1397 lines) |
| 3.10 | Wire save button | Part of `reader.js` | pendingSave + toggle |
| 3.11 | Wire position auto-save | Part of `reader.js` | Debounce + sendBeacon |
| 3.12 | Wire history auto-log | Part of `reader.js` | Web Crypto SHA-256 (M3) |

**Verify:** Fetch URL → read → save → toast. Page flip persists position. Logged-out save → auth modal → auto-save (Flow A). History entry created on article open.

---

### Branch 7: `feature/frontend-library-history`

**Sprint 3 tasks** — Library and history pages, wired to API.

| Task | Description | Files | Source |
|------|-------------|-------|--------|
| 3.13 | Build library page | `src/js/library.js`, `src/css/library.css` | `mockup_library.html` (1626 lines) |
| 3.14 | Build history page | `src/js/history.js`, `src/css/history.css` | `mockup_history.html` (1426 lines) |

**Verify:** Library shows saved articles, sort/filter/collections work, remove + undo (M5). History shows date-grouped entries, delete single, clear all. Click article → opens in reader.

---

### Branch 8: `feature/deploy`

**Sprint 4 tasks** — Railway deployment, production config, OAuth URLs, E2E testing.

| Task | Description |
|------|-------------|
| 4.1 | Commit all work to GitHub |
| 4.2 | Create Railway project |
| 4.3 | Set Railway environment variables (7 vars) |
| 4.4 | Run production migration |
| 4.5 | Configure Supabase OAuth redirect URLs |
| 4.6 | End-to-end testing (10 PRD criteria) |
| 4.7 | Fix production-only issues |

**Verify:** All 10 PRD verification criteria pass at public Railway URL.

---

### Branch Summary

| # | Branch | Tasks | Sprint | Key Output |
|---|--------|-------|--------|------------|
| 1 | `feature/project-scaffold` | 1.1-1.5, 1.10-1.15 | 1 | Flask + Vite running |
| 2 | `feature/database-and-auth` | 1.6-1.9 | 1 | Tables + JWT auth |
| 3 | `feature/api-endpoints` | 2.1-2.5 | 2 | Full API + tests |
| 4 | `feature/frontend-foundation` | 3.1-3.7 | 3 | SPA shell + shared modules |
| 5 | `feature/frontend-auth` | 3.8 | 3 | Auth modal |
| 6 | `feature/frontend-reader` | 3.9-3.12 | 3 | Flipbook + save + sync |
| 7 | `feature/frontend-library-history` | 3.13-3.14 | 3 | Library + History pages |
| 8 | `feature/deploy` | 4.1-4.7 | 4 | Live at Railway URL |
