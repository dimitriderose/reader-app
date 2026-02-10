# Reader App — Future Enhancements

## Authentication
- [ ] Configure Google OAuth in Supabase (Dashboard → Auth → Providers → Google) — requires Google Cloud Console OAuth 2.0 credentials (Client ID + Secret), add Supabase callback URL as authorized redirect URI
- [ ] Configure Apple Sign In (requires Apple Developer account: Service ID, Team ID, Key)
- [ ] Add email confirmation flow (currently `mailer_autoconfirm: false` in Supabase)
- [ ] Password reset UI (form exists in auth modal, needs testing with Supabase email templates)

## Scraper / Content Extraction
- [ ] JS-rendered sites fail (MSN, Bloomberg, etc.) — consider headless browser (Playwright/Puppeteer) or a third-party API (Diffbot, Mercury Parser)
- [ ] Add support for paywalled content via reader-mode extraction (similar to Firefox Reader View)
- [x] PDF file support — renders pages visually via pdf.js canvas (lazy-loaded, ~445KB chunk)
- [x] Markdown file support — parsed with `marked` (GFM, tables, code fences, task lists)
- [ ] EPUB file support
- [ ] Better error messages per domain (e.g., "This site requires JavaScript" vs "Access denied")

## Reader Experience
- [ ] Reading time estimate (word_count / 225 wpm) displayed in toolbar
- [ ] Swipe gestures for mobile page flipping (touch events exist but may need tuning)
- [ ] Full-screen reading mode (F11 or button)
- [ ] Bookmark specific pages within an article
- [ ] Text highlighting and annotation
- [ ] Text-to-speech integration

## Library & Collections
- [ ] Drag-and-drop to reorder collections
- [ ] Collection colors — add color picker UI (backend supports `color` field)
- [ ] Bulk actions (select multiple articles, move/delete)
- [ ] Search/filter articles by title or domain
- [ ] Import/export library (JSON or OPML)

## History
- [ ] "Save to library" button directly on history entries
- [ ] Filter history by date range
- [ ] Search history by title

## Performance & Infrastructure
- [ ] Deploy to Railway (Dockerfile exists, needs env vars configured)
- [ ] Set up Supabase OAuth redirect URLs for production domain
- [ ] Vite production build optimization (`npm run build`)
- [ ] Flask serves built static files in production (already configured in app factory)
- [ ] Add rate limiting to API endpoints
- [ ] Add request logging / error monitoring (Sentry)

## Testing
- [ ] Backend API tests (`tests/` directory exists, needs test cases)
- [ ] Frontend smoke tests (Playwright or Cypress)
- [ ] Test auth flow end-to-end (sign up, sign in, sign out, password reset)

## UI Polish
- [ ] Loading skeleton screens for library and history views
- [ ] Offline support (service worker + cached articles)
- [ ] PWA manifest for "Add to Home Screen"
- [ ] Responsive improvements for tablets
- [ ] Keyboard shortcuts help modal (? key)
