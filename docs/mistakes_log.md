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

### M14 — Empty view containers in index.html
**Where:** `src/index.html` — `#inputView` and `#readerView` containers
**What:** The SPA shell had empty `<div>` containers for the input view and reader view. reader.js references ~20 DOM IDs (flipContent, fsVal, fontToggle, saveBtn, pageShadow, flipPrev, flipNext, pageCurl, flipbook, pageNum, pageTotal, progressFill, etc.) that didn't exist in the HTML, so `initReader()` would find `null` for every element — making the entire reader non-functional.
**Fix:** Added the inner HTML from the design_v2.html mockup into both containers: input view (segmented tabs, URL/file/paste panels) and reader view (toolbar, flipbook, bottom bar, progress bar).
**Lesson:** When decomposing a monolithic HTML mockup into an SPA shell + JS modules, verify that all DOM elements referenced by the JS modules actually exist in the HTML. Empty containers only work if the JS dynamically renders everything (like library.js and history.js do), but reader.js expected static HTML.

### M15 — Reader view visibility used wrong CSS class
**Where:** `src/js/reader.js` — `showReader()` and `showInput()` functions
**What:** reader.js used `.active` class to show the reader view (`readerView.classList.add('active')`), matching the mockup's `.reader-view.active { display: flex; }`. But the SPA shell uses `.hidden { display: none !important; }` to hide views. Since `!important` always wins, adding `.active` couldn't override `.hidden`, so the reader view never appeared.
**Fix:** Changed to use `.hidden` class consistently: `showReader()` removes `hidden`, `showInput()` adds `hidden`. Updated the keyboard handler check to `readerView.classList.contains('hidden')`.
**Lesson:** When CSS has `!important` rules, other classes can't override them. Choose one visibility mechanism and use it everywhere. The SPA shell and individual modules must agree on the same toggle pattern.

### M16 — sendBeacon can't send PATCH requests or custom headers
**Where:** `src/js/reader.js` — `onBeforeUnload()` function
**What:** Used `navigator.sendBeacon()` for final position save on tab close. sendBeacon always sends POST with no custom headers. The position endpoint requires PATCH method + `Authorization: Bearer` header. Result: every beforeunload save would silently fail (405 Method Not Allowed + 401 Unauthorized).
**Fix:** Replaced with `fetch()` using `keepalive: true`, which supports custom methods and headers. Cache the access token synchronously so it's available in the sync `beforeunload` handler.
**Lesson:** `sendBeacon()` is limited to POST with no custom headers. For authenticated endpoints or non-POST methods, use `fetch()` with `keepalive: true` instead. Both survive page unload, but fetch is more flexible.

### M17 — Library/History card clicks didn't actually open articles
**Where:** `src/js/library.js` — `openArticle()`, `src/js/history.js` — `openEntry()`
**What:** Clicking a card stored the article/entry ID in sessionStorage and navigated to '/', but no code read these values. The article would never load — the user would just see the empty input view.
**Fix:** Added pickup logic in app.js's `route()` function: when routing to '/', check sessionStorage for `reader-article-id` or `reader-history-id`, fetch the full article/entry from the API, and call the reader's `openArticle()` or `openArticleFromHistory()`.
**Lesson:** sessionStorage-based inter-module communication requires both a writer and a reader. Always verify the receiving end of the pattern exists.

### M18 — No sign-out functionality
**Where:** `src/js/auth.js`
**What:** The user avatar rendered in the header when signed in, but clicking it did nothing. `supabase.auth.signOut()` was never called anywhere. Users could sign in but not sign out (except by clearing browser data).
**Fix:** Added a click handler on the avatar that shows a dropdown with a "Sign out" button. Clicking it calls `supabase.auth.signOut()`.
**Lesson:** Every auth system needs both sign-in AND sign-out. Don't defer sign-out to "later" — it's part of the core auth flow.

### M19 — Sort preference not persisted to server
**Where:** `src/js/library.js`
**What:** Changing the sort dropdown re-fetched articles with the new sort but never called `PATCH /api/user/preferences` to save it. On next visit, sort would reset to the default 'lastread'. The PRD says "Sort preference persists per user."
**Fix:** On sort change, also call `api.patch('/api/user/preferences', { sort_preference: value })`. On `mountLibrary()`, fetch the user's profile to get their stored `sort_preference`.
**Lesson:** If the PRD says a preference "persists", it must be saved server-side — not just in JS variable state.

### M20 — History entry position not updated during reading
**Where:** `src/js/reader.js` — `onPageFlip()`, `logToHistory()`
**What:** `logToHistory()` recorded the initial page when first opening an article, but subsequent page flips only updated the library article position (via `PATCH /api/articles/:id/position`). History entries' positions were never updated. When reopening from history, the user would see their initial page, not their last-read page.
**Fix:** Capture the history entry ID from the `POST /api/history` response. On page flip, if a `historyEntryId` exists, also call `PATCH /api/history/:id/position`.
**Lesson:** If two systems track reading position (library articles and history entries), both need to be updated on the same event.

### M21 — Duplicate CSS loading (link tags + Vite imports)
**Where:** `src/index.html` lines 7-10, `src/js/app.js` lines 11-15
**What:** index.html had `<link>` tags for 4 CSS files. app.js also imported all 5 CSS files via Vite's CSS import syntax. In production, Vite bundles CSS from JS imports and the `<link>` tags would reference non-existent unbundled files (404 errors). In dev, both mechanisms loaded the CSS, causing duplicate stylesheets.
**Fix:** Removed all `<link rel="stylesheet">` tags from index.html. Vite CSS imports in app.js handle everything.
**Lesson:** With Vite, CSS should be imported from JS (`import '../css/file.css'`) — not linked in HTML. The two approaches conflict in production builds.

### M22 — user.py update_preferences crashes on missing request body
**Where:** `app/api/user.py` — `update_preferences()` function
**What:** `request.get_json()` returns `None` if the body is missing or malformed. The next line `if 'sort_preference' in data:` would throw `TypeError: argument of type 'NoneType' is not iterable`.
**Fix:** Added `if not data: return jsonify({'error': 'Request body is required'}), 400` guard.
**Lesson:** Always guard `request.get_json()` against `None` before accessing the result. Other endpoints in the codebase already did this — this one was missed.
