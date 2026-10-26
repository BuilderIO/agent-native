# CI image for the Slides authoring browser checks. The official Playwright
# image carries Chromium, Firefox, WebKit and their system libraries but not a
# compiler, and `pnpm install` builds node-pty from source.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    python3 \
  && rm -rf /var/lib/apt/lists/*
