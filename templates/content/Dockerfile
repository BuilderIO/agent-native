# Content as a long-lived Node server (Nitro's node-server preset), for a host
# that keeps instances running, such as Cloud Run with a minimum instance.
# Build from the repository root, which the workspace install needs:
#
#   docker build -f templates/content/Dockerfile \
#     --build-arg AGENT_NATIVE_BUILD_SHA="$(git rev-parse HEAD)" \
#     -t content-node-server .
#
# docs/content-long-lived-server.md covers the environment, routing and checks.

ARG NODE_VERSION=24.14.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /repo

# The same native build dependencies the prebuilt deploy workflow installs
# before `pnpm install` (a workspace package compiles node-canvas).
RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    g++ \
    git \
    libcairo2-dev \
    libgif-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libpixman-1-dev \
    librsvg2-dev \
    make \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3
RUN corepack enable

COPY . .
RUN pnpm install --frozen-lockfile
# Pages name their build as `__an_build=<sha>`, which is how a deploy is
# verified; pass `--build-arg AGENT_NATIVE_BUILD_SHA=$(git rev-parse HEAD)`.
ARG AGENT_NATIVE_BUILD_SHA=""
RUN AGENT_NATIVE_BUILD_SHA="$AGENT_NATIVE_BUILD_SHA" \
  NITRO_PRESET=node-server pnpm --filter content build

FROM node:${NODE_VERSION}-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=8080

# `.output/` is self-contained: the build copies the SSR packages it leaves
# external (React and friends) into `.output/server/node_modules`.
COPY --from=build --chown=node:node /repo/templates/content/.output ./.output

USER node
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
