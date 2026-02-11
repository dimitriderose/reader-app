# Stage 1: Build frontend
FROM node:18-alpine AS frontend
WORKDIR /build

# Accept Supabase config as build args so Vite can inline them
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

COPY package.json package-lock.json* ./
RUN npm ci
COPY src/ src/
COPY vite.config.js .env* ./
RUN npx vite build

# Stage 2: Production
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies for Playwright Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libatspi2.0-0 libwayland-client0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Chromium browser (must run as root, before USER switch)
RUN playwright install chromium

# Create non-root user
RUN addgroup --system app && adduser --system --ingroup app app

# Copy application code
COPY app/ app/
COPY reader_app.py .

# Copy built frontend from Stage 1
COPY --from=frontend /build/app/static/dist app/static/dist/

# Switch to non-root user
RUN chown -R app:app /app
USER app

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-5000}/healthz')" || exit 1

CMD gunicorn \
  --bind 0.0.0.0:${PORT:-5000} \
  --workers ${WEB_CONCURRENCY:-2} \
  --timeout 120 \
  --access-logfile - \
  --error-logfile - \
  reader_app:app
