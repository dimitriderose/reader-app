# Product Requirements: Reader App V1

## Context

The reader app currently has zero persistence — articles vanish on page refresh, and reading position is lost. The save button in the V2 design captures a well-structured data payload but has no backend to send it to. Users need accounts, a library to organize saved articles, reading history to resume where they left off, and sync across devices.

---

## Feature Areas

### 1. User Accounts & Authentication
- **Email + password** registration and login as baseline
- **OAuth sign-in** with Google and GitHub as convenience options
- Simple profile: display name, email, avatar (from OAuth or initials)
- "Stay signed in" / remember me option
- Password reset via email
- Logged-out state: app still works for reading (no save/library/history features until signed in)
- Sign-in prompt appears when user tries to save an article while logged out

### 2. Save to Library
- The existing save/bookmark button becomes "Add to Library"
- Saving an article stores: title, source URL, full content, reading position, user preferences (font size, font family, theme), word count, and timestamp
- Toggling save again removes the article from library
- Toast confirmation on save/remove
- When saving, user can optionally assign to a collection (or save to "Uncategorized" by default)

### 3. Auto-Save Reading Position
- Every page flip silently persists the current page number — no manual action required
- Auto-save only works for articles already in the library
- When the user closes the tab and returns later, their position is preserved
- Syncs across devices via the user's account

### 4. Resume Reading
- Opening an article from the library loads it at the last-read page, not page 1
- Restores user preferences (font size, font family, theme) as they were when reading that article

### 5. Library Page
- A new view (separate from the input view and reader view) listing all saved articles
- Accessible via a nav element (e.g., a "Library" button/icon in the toolbar or input view)
- Each article appears as a card showing:
  - **Title** (extracted from content)
  - **Source domain** with favicon (e.g., `nytimes.com` with its icon)
  - **Collection** badge/label (if assigned)
  - **Reading progress** — visual progress bar + "Page 4 of 12" text
  - **Estimated reading time** — calculated from word count (~225 WPM, e.g., "8 min read")
  - **Date saved** — relative time format ("2 days ago", "Last week")
  - **Last read** — when the user last flipped a page ("Read 3 hours ago")
- Empty state: friendly message with CTA to paste a URL or upload a file

### 6. Collections (Simple Folders)
- Each article belongs to **one** collection (or "Uncategorized" by default)
- Users can create, rename, and delete collections
- Deleting a collection moves its articles to "Uncategorized" (doesn't delete articles)
- Library page can be filtered by collection (sidebar or dropdown)
- Drag-and-drop or menu option to move articles between collections
- Example collections: "Tech", "Fiction", "Work", "Read Later"

### 7. Reading History
- A dedicated "History" page/tab showing all articles the user has opened — even ones not saved to library
- Each history entry shows:
  - **Title**
  - **Reading position** — "Page 3 of 10" or "Finished"
  - **Last opened** — timestamp
  - **Source domain**
- Entries are clickable — jumps back to the article at the last-read page
- History is automatically logged whenever an article is opened (no user action needed)
- Users can clear individual entries or clear all history
- History is per-account (syncs across devices)

### 8. Remove from Library
- Each library card has a remove/delete action
- Confirmation before deletion (undo-toast pattern: "Article removed — Undo")
- Removes article and all associated reading progress
- Article still appears in Reading History (history is separate from library)

### 9. Sort Library
- Default sort: **Last read** (most recently read articles first)
- Additional sort options:
  - **Date saved** (newest saved first)
  - **Progress** (least progress first — "finish what you started")
- Sort control in the library view header
- Sort preference persists per user

### 10. Reading Stats (on library cards)
- Estimated reading time based on word count (~225 WPM)
- Reading progress as percentage and page count
- Domain/source attribution with favicon

### 11. Multi-Device Sync
- All data tied to user account, stored server-side
- Library, collections, reading positions, history, and preferences sync across any browser where the user is signed in
- No conflict resolution needed — last-write-wins for reading position (most recent page flip is always correct)

---

## User Flows

### Flow A: New User Onboarding
1. User visits the app → sees input view (URL/text/file)
2. User reads an article without signing in → full reader experience works
3. User clicks save → sign-in prompt appears
4. User creates account (email or OAuth) → article is saved to library
5. Library and history become available

### Flow B: Save & Read Later
1. Signed-in user enters URL → clicks "Read"
2. Article loads in flipbook reader
3. User clicks save → toast: "Saved to library" (assigned to "Uncategorized" or chosen collection)
4. User reads a few pages → position auto-saved on each flip
5. User closes tab
6. User returns on same or different device → opens library → sees article with progress "Page 3 of 10"
7. User clicks card → article opens at page 3 with their preferences

### Flow C: Library & Collections Management
1. User opens library view
2. Sees all saved articles sorted by last read
3. Filters by collection using sidebar/dropdown
4. Creates a new collection "Tech Articles"
5. Moves articles into the collection
6. Switches sort to "Progress" to find unfinished articles
7. Removes an old article → undo toast appears for 5 seconds

### Flow D: Reading History
1. User opens an article via URL (does NOT save it)
2. Reads to page 5, then closes
3. Later, opens History page → sees the article listed: "Page 5 of 12, opened 2 hours ago"
4. Clicks the entry → article reloads at page 5
5. User decides to save it → clicks save button → now in library too

### Flow E: Multi-Device
1. User reads article on laptop, reaches page 7
2. Opens app on phone, signs in with same account
3. Library shows article at page 7
4. Reads to page 9 on phone
5. Returns to laptop → library shows page 9

---

## Out of Scope (V2+)
- Full-text search across saved articles
- Offline/PWA support
- Import/export library
- Social features (sharing, public collections)
- Annotation/highlighting within articles
- Nested collections (folders within folders)

---

## Verification Criteria
- Create account → sign in → sign out → sign in again (both email and OAuth)
- Save an article → appears in library with correct title, domain, progress
- Read several pages → close and reopen → library shows updated progress
- Click article in library → opens at correct page with correct preferences
- Assign article to collection → filter library by collection → article appears
- Open article without saving → appears in History → clickable to resume
- Remove article from library → undo toast works → article gone but still in history
- Sort by each option → order changes correctly
- Sign in on second browser → library and history match
- Estimated reading time shows reasonable values (5-min article ~ 1000-1250 words)
