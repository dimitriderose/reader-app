# Mistakes Log

Track mistakes caught during planning and implementation to avoid repeating them.

---

## Planning Phase Mistakes

### M1 — Dockerfile CMD exec form doesn't expand shell variables
**Where:** `docs/implementation_v1.md` Phase 1 Dockerfile
**What:** Used JSON exec form `CMD ["gunicorn", "--bind", "0.0.0.0:${PORT:-5000}", ...]` — shell variables aren't expanded in exec form.
**Fix:** Use shell form `CMD gunicorn --bind 0.0.0.0:${PORT:-5000} reader_app:app`
**Lesson:** JSON exec form bypasses the shell. Any `$VAR` or `${VAR:-default}` requires shell form or `CMD ["sh", "-c", "..."]`.

### M2 — Article model index used wrong column
**Where:** `docs/implementation_v1.md` Phase 2 Article model
**What:** Both `ix_articles_user_lastread` and `ix_articles_user_saved` indexes used `saved_at.desc()`. The first should use `last_read_at.desc()`.
**Fix:** Changed to `db.Index('ix_articles_user_lastread', 'user_id', last_read_at.desc())`
**Lesson:** When two indexes look similar, double-check each references the correct column.

### M3 — Dead import (CryptoJS) in frontend code
**Where:** `docs/implementation_v1.md` Phase 6 history auto-logging
**What:** Imported `CryptoJS from 'crypto-js'` but code used Web Crypto API (`crypto.subtle.digest`). Would cause build failure since `crypto-js` wasn't in `package.json`.
**Fix:** Removed the import. Web Crypto API needs no imports.
**Lesson:** When switching between implementation approaches, remove leftover imports from the previous approach.

### M4 — Dockerfile build order: purged Node before running Vite
**Where:** `docs/implementation_v1.md` Phase 1 original Dockerfile
**What:** Single-stage Dockerfile removed Node.js before `npx vite build`, causing build failure.
**Fix:** Multi-stage build: Stage 1 (Node) builds frontend, Stage 2 (Python) copies the built assets.
**Lesson:** Multi-stage Docker builds separate build-time and runtime dependencies cleanly.

### M5 — Library undo re-created articles with new ID
**Where:** `docs/implementation_v1.md` Phase 7 library remove+undo
**What:** Original approach: DELETE immediately, re-POST on undo. This creates a new article ID, breaking `history_entries.article_id` foreign key.
**Fix:** Deferred delete pattern — remove from DOM immediately, delay the actual DELETE API call for 5 seconds. Undo cancels the timer.
**Lesson:** Think through foreign key relationships before designing undo patterns. Prefer deferred deletes over delete-then-recreate.

### M6 — Missing CORS initialization
**Where:** `docs/implementation_v1.md` Phase 1 app factory
**What:** `flask-cors` was in `requirements.txt` but never initialized with `CORS(app)`.
**Fix:** Added `from flask_cors import CORS; CORS(app)` in `create_app()`.
**Lesson:** Adding a dependency to requirements isn't enough — it must be wired into the app.

### M7 — Missing `__init__.py` for middleware package
**Where:** `docs/implementation_v1.md` Phase 1
**What:** `app/middleware/` directory was created but no `__init__.py`, so Python wouldn't recognize it as a package.
**Fix:** Added explicit instruction to create empty `app/middleware/__init__.py`.
**Lesson:** Every Python package directory needs `__init__.py`.

### M8 — Config style inconsistency between documents
**Where:** `docs/technical_design_v1.md` vs `docs/implementation_v1.md`
**What:** Tech design used `os.environ['KEY']` (raises KeyError if missing), implementation used `os.environ.get('KEY', '')` (returns empty string).
**Fix:** Harmonized both to `os.environ.get()` style.
**Lesson:** Keep config patterns consistent across documents. Pick one style early.

### M9 — word_count source ambiguity
**Where:** Both docs
**What:** Unclear whether client or server computes `word_count`. Tech design's POST request body didn't mention it, but the articles table had the column.
**Fix:** Added explicit notes in both docs: "word_count is computed server-side from content_html on save."
**Lesson:** For derived/computed fields, explicitly state who computes them and when.

### M10 — Designed for deprecated HS256 JWT Secret instead of JWKS
**Where:** `docs/technical_design_v1.md` auth flow, `docs/implementation_v1.md` middleware
**What:** Designed auth middleware around `SUPABASE_JWT_SECRET` with HS256 symmetric verification. Supabase migrated to asymmetric JWT Signing Keys (ES256 via JWKS) — new projects after Oct 2025 use this by default, all projects must migrate by late 2026.
**Fix:** Replaced HS256 secret verification with `PyJWKClient` fetching public keys from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. Removed `SUPABASE_JWT_SECRET` from config and `.env`. Changed `pyjwt` to `pyjwt[crypto]` in requirements.
**Lesson:** Check the current state of third-party auth services before designing. APIs and auth flows evolve — don't assume the docs you read 6 months ago are still current.

### M11 — font_family VARCHAR(10) too small
**Where:** `docs/technical_design_v1.md` schema
**What:** `VARCHAR(10)` can't hold font names like `"Georgia, serif"` or `"Courier New"`.
**Fix:** Changed to `VARCHAR(50)`.
**Lesson:** Size string columns for realistic data, not just the shortest example.

### M12 — Used legacy anon key instead of new publishable key
**Where:** All config files, `.env`, both design docs, `supabase.js` code
**What:** Used `SUPABASE_ANON_KEY` (legacy JWT-based `eyJ...` format) throughout the project. Supabase replaced `anon`/`service_role` keys with `publishable` (`sb_publishable_...`) / `secret` (`sb_secret_...`) keys. Legacy keys will be removed.
**Fix:** Renamed all references from `SUPABASE_ANON_KEY` → `SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_ANON_KEY` → `VITE_SUPABASE_PUBLISHABLE_KEY`. User swaps in the publishable key value from dashboard.
**Lesson:** Same as M10 — check current state of third-party services before designing. This was caught alongside the JWT signing change but is a separate migration.

### M13 — Overwriting reader_app.py without extracting scraper
**Where:** `docs/implementation_v1.md` Phase 1
**What:** Phase 1 overwrites `reader_app.py` with a 2-line app factory import, but the scraper service (Phase 4) needs the existing code as source material.
**Fix:** Added bold warning: extract scraper logic into `app/services/scraper.py` before overwriting.
**Lesson:** When replacing a file that contains reusable code, extract it first.

---

## Implementation Phase Mistakes

*(To be added as we build)*
