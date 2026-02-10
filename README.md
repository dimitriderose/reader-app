# Reader App

A distraction-free article reader with flipbook-style pagination, user accounts, a personal library, reading history, and multi-device sync.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Flask + SQLAlchemy |
| Database | Supabase PostgreSQL |
| Auth | Supabase Auth (email/password, Google, GitHub OAuth) |
| Frontend | Vanilla JS (ES modules) + Vite |
| Deployment | Railway + Docker |

## Features

- Fetch and read any article in a clean, paginated flipbook view
- Three reading themes (light, sepia, dark) with adjustable font
- Save articles to a personal library with collections
- Reading position auto-saves across devices
- Full reading history with one-click resume
- Sign in with email, Google, or GitHub

## Project Structure

```
reader-app/
├── app/                  # Flask backend (app factory)
│   ├── api/              # API route blueprints
│   ├── models/           # SQLAlchemy models
│   ├── middleware/        # JWT auth decorator
│   └── services/         # Scraper, word count
├── src/                  # Frontend source (Vite)
│   ├── js/               # ES modules (router, reader, library, etc.)
│   ├── css/              # Stylesheets
│   └── index.html        # SPA shell
├── docs/                 # Design docs, mockups, PRD
├── reader_app.py         # Entry point
├── webscraper.py         # Standalone CLI scraper
├── Dockerfile
└── docker-compose.yml
```

## Prerequisites

- Python 3.11+
- Node.js 18+
- A Supabase project (free tier)

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/your-username/reader-app.git
   cd reader-app
   ```

2. Copy the example env file and fill in your Supabase credentials:
   ```bash
   cp .env.example .env
   ```

3. Install Python dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate   # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. Install frontend dependencies:
   ```bash
   npm install
   ```

5. Run database migrations:
   ```bash
   flask db upgrade
   ```

6. Start development servers:
   ```bash
   # Terminal 1 — Flask backend
   flask run

   # Terminal 2 — Vite dev server
   npm run dev
   ```

   Open `http://localhost:5173` in your browser.

## Legacy CLI Scraper

The standalone web scraper is still available:

```bash
python webscraper.py <URL> [output.docx|output.html]
```

## Documentation

- [Product Requirements](docs/product_requirements_v1.md)
- [Technical Design](docs/technical_design_v1.md)
- [Implementation Guide](docs/implementation_v1.md)
- [Sprint Plan](docs/sprint_plan_v1.md)
