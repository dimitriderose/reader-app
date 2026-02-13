# Reader App — Future Enhancements

## Authentication
- [x] Google OAuth sign-in — frontend `handleOAuthSignIn('google')` with Supabase `signInWithOAuth`, OAuth button bindings, and redirect URL support for dev+prod. Backend JWT validation via JWKS with auto-provisioned user profiles. *(commits `af5a7a2`, `5fb7b8c`, PR #2)*
- [x] Email confirmation flow — `handleRegister()` detects when Supabase requires email confirmation (no session returned) and shows "Check your email to confirm your account" toast. *(commit `af5a7a2`)*
- [x] Password reset UI — full forgot-password form with email validation, `resetPasswordForEmail` Supabase call, and success confirmation showing the submitted email. *(commit `af5a7a2`)*

## Scraper / Content Extraction
- [x] JS-rendered sites (MSN, Bloomberg, etc.) — solved with 3-layer scraper fallback: requests → cloudscraper → Playwright headless Chromium. Includes signal-driven escalation, thin-content detection, CF challenge detection, and Edge `read://` URL unwrapping. *(PR #3, commits `a114fb3`..`cd968af`)*
- [ ] Add support for paywalled content via reader-mode extraction (similar to Firefox Reader View)
- [x] PDF file support — renders pages visually via pdf.js canvas (lazy-loaded, ~445KB chunk)
- [ ] PDF clickable links — extract link annotations via `page.getAnnotations()`, overlay transparent `<a>` elements over rendered page images
- [x] Markdown file support — parsed with `marked` (GFM, tables, code fences, task lists)
- [x] EPUB file support — JSZip extraction with LCP passphrase decryption, Adobe DRM detection, clickable TOC/chapter links
- [ ] Better error messages per domain (e.g., "This site requires JavaScript" vs "Access denied")

## Reader Experience
- [x] Reading time estimate (word_count / 225 wpm) displayed in toolbar — computes from server-provided `word_count` for library articles or client-side text extraction for URL/paste/file content. Shows `~X min read` in toolbar, hidden on mobile to prevent overflow.
- [x] Swipe gestures for mobile page flipping — touch start/end handlers with 40px threshold and horizontal vs. vertical discrimination, passive event listeners. *(reader.js lines 1188-1203)*
- [x] Full-screen reading mode (F11 or button) — Fullscreen API toggle with toolbar button, F11 keyboard shortcut, auto-hide header in fullscreen, re-pagination on viewport change. Hidden on devices without Fullscreen API support.
- [x] Bookmark specific pages within an article — per-page bookmark toggle in toolbar (flag icon), left-side sidebar (mirroring highlights on right) with search/filter, editable labels, drag-to-resize handle, keyboard shortcuts (B to toggle, Ctrl+B for sidebar), current-page highlighting, relative timestamps, localStorage + server persistence via `Bookmark` model and `/api/articles/:id/bookmarks` REST API (GET/POST/DELETE). Mobile-responsive full-width drawer. Unique constraint on (article_id, page_number).
- [x] Text highlighting and annotation — selection-based highlighting with 4 color choices (yellow/green/blue/pink), optional annotation notes, XPath-based range serialization that survives re-pagination, highlights sidebar panel for browsing/editing/deleting. Server-persisted via `Highlight` model and `/api/articles/:id/highlights` REST API (CRUD). New `highlight-manager.js` module.
- [x] Text-to-speech / audio reader — Web Speech API with play/pause/stop controls, skip forward/backward between sentences, adjustable speed (0.75x–2x), voice selection, sentence-level highlighting synced with speech, slide-up audio player bar. Themed for light/sepia/dark modes with responsive mobile support. *(PR #4, commit `9376232`)*
- [x] Night reading mode with blue light filter — 4th theme option ("Night") with warm amber-shifted dark palette (`--bg: #1C1810`, `--text: #D8CFC0`, `--accent: #C4A060`), subtle sepia filter on reading content, theme dot in header. Works with existing generic theme system — no JS changes needed.
- [x] Adjustable line height and margins — 3-preset cycle buttons in toolbar: line spacing (Tight/Spacing/Loose) and margins (Narrow/Margins/Wide). Persisted in localStorage (`reader-lh`, `reader-margin`) and server-side per article (`line_height`, `margin_width` columns). Re-paginates on change. Presets adapt to serif/sans font and desktop/mobile breakpoints.
- [x] Progress bar per chapter (for EPUBs) — chapter indicator in bottom bar showing "Chapter X of Y" (shortened to "Ch. X/Y" on mobile). Built by inspecting `.epub-chapter` element `offsetLeft` values after pagination. Rebuilds on re-pagination, hidden for non-EPUB content.

## Library & Collections
- [ ] Drag-and-drop to reorder collections
- [ ] Collection colors — add color picker UI (backend supports `color` field)
- [ ] Bulk actions (select multiple articles, move/delete)
- [ ] Search/filter articles by title or domain
- [ ] Import/export library (JSON or OPML)
- [ ] Sort collections alphabetically or by date
- [ ] Article tags/labels (separate from collections)

## History
- [ ] "Save to library" button directly on history entries
- [ ] Filter history by date range
- [ ] Search history by title
- [ ] Clear all history option
- [ ] Auto-delete history older than N days (configurable)

## Performance & Infrastructure
- [x] Deploy to Railway — live at https://reader-app-production-2989.up.railway.app/ (Docker multi-stage build, Gunicorn, health checks, auto-deploy on push)
- [x] Vite production build optimization — frontend built in Docker stage 1, served by Flask in production
- [x] Flask serves built static files in production (SPA catch-all route)
- [x] Supabase OAuth redirect URLs for production — `redirectTo` uses `window.location.origin` to support both localhost and Railway. Each origin must be added to Supabase Auth Redirect URLs allowlist. *(PR #2, commit `24e8419`)*
- [x] Railway env vars for auth support — Vite `VITE_*` env vars passed as Docker build args so `createClient()` works in production. Railway auto-passes matching env vars. *(PR #1, commit `179d0e2`)*
- [ ] Add rate limiting to API endpoints
- [ ] Add request logging / error monitoring (Sentry)
- [ ] CDN for static assets
- [ ] Gzip/Brotli compression for API responses
- [ ] Database connection pooling

## Testing
- [x] Backend API tests — full test suite covering articles CRUD, collections CRUD (unique name constraint, cascade behavior), and history endpoints (content-hash upsert, clear-all, position update). Flask test client with in-memory SQLite and mock JWT auth. *(commit `6ff31e3`)*
- [x] Scraper fallback tests — 25 tests covering the 3-layer fallback chain, CF detection, thin-content detection, and caching. *(PR #3, commit `a114fb3`)*
- [ ] Frontend smoke tests (Playwright or Cypress)
- [ ] Test auth flow end-to-end (sign up, sign in, sign out, password reset)
- [ ] EPUB parsing edge cases (malformed EPUBs, large files, missing metadata)
- [ ] PDF rendering tests (multi-page, encrypted, large files)

## UI Polish
- [ ] Loading skeleton screens for library and history views
- [ ] Offline support (service worker + cached articles)
- [ ] PWA manifest for "Add to Home Screen"
- [ ] Responsive improvements for tablets
- [ ] Keyboard shortcuts help modal (? key)
- [ ] Onboarding tooltip/tour for first-time users
- [ ] Drag-and-drop file upload animation
- [ ] Smooth page transition animations
- [ ] Dark mode improvements (better contrast, OLED black option)

## Accessibility
- [ ] Screen reader support (ARIA labels, roles, live regions)
- [ ] High contrast mode
- [ ] Reduced motion preference support
- [ ] Focus indicators for keyboard navigation
- [ ] Alt text for PDF page images
