# Builds the web service from the repo root (it needs both frontend/ and web/):
#   docker build -f web/Dockerfile .

# --- 1. Build the frontend pages ---
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# No VITE_API_URL / VITE_WS_URL on purpose: the pages call /api on their own
# site, which this service carries through to the backend. Railway passes
# service variables with these names in as build args.
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_SENTRY_DSN=""
RUN VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" VITE_SENTRY_DSN="$VITE_SENTRY_DSN" npm run build

# --- 2. The Ruby service that serves them ---
FROM ruby:3.3-slim
WORKDIR /app
# Compilers and OpenSSL headers for the gems with native extensions.
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential libssl-dev \
  && rm -rf /var/lib/apt/lists/*
COPY web/Gemfile web/Gemfile.lock web/.ruby-version ./
RUN bundle config set --local deployment true \
  && bundle config set --local without test \
  && bundle install
COPY web/ ./
COPY --from=frontend /frontend/dist ./public
ENV DIST_DIR=/app/public
CMD ["bundle", "exec", "ruby", "bin/server.rb"]
