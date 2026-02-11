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
- [ ] PDF clickable links — extract link annotations via `page.getAnnotations()`, overlay transparent `<a>` elements over rendered page images
- [x] Markdown file support — parsed with `marked` (GFM, tables, code fences, task lists)
- [x] EPUB file support — JSZip extraction with LCP passphrase decryption, Adobe DRM detection, clickable TOC/chapter links
- [ ] Better error messages per domain (e.g., "This site requires JavaScript" vs "Access denied")

## Reader Experience
- [ ] Reading time estimate (word_count / 225 wpm) displayed in toolbar
- [ ] Swipe gestures for mobile page flipping (touch events exist but may need tuning)
- [ ] Full-screen reading mode (F11 or button)
- [ ] Bookmark specific pages within an article
- [ ] Text highlighting and annotation
- [ ] Text-to-speech integration
- [ ] Night reading mode with blue light filter
- [ ] Adjustable line height and margins
- [ ] Progress bar per chapter (for EPUBs)

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
- [ ] Set up Supabase OAuth redirect URLs for production domain
- [ ] Configure Railway env vars for full auth support (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, DATABASE_URL)
- [ ] Add rate limiting to API endpoints
- [ ] Add request logging / error monitoring (Sentry)
- [ ] CDN for static assets
- [ ] Gzip/Brotli compression for API responses
- [ ] Database connection pooling

## Testing
- [ ] Backend API tests (`tests/` directory exists, needs test cases)
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
