# Stage 1: Build frontend
FROM node:18-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY src/ src/
COPY vite.config.js ./
RUN npx vite build

# Stage 2: Production
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
COPY --from=frontend /app/app/static/dist app/static/dist/
EXPOSE 5000
CMD gunicorn --bind 0.0.0.0:${PORT:-5000} reader_app:app
