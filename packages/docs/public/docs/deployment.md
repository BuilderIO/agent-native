# Deployment

Agent-native apps can be deployed to any platform. The build uses React Router for the frontend and H3 for API routes. For edge/serverless targets, set `NITRO_PRESET` to bundle the server for the target platform.

## How It Works

`agent-native build` produces two outputs:

```
build/
  client/          # Static assets (JS, CSS, images)
  server/          # SSR server module (React Router)
```

For **Node.js** (default), this is all you need — run the server directly.

For **edge/serverless** targets, set `NITRO_PRESET` and the build adds a post-processing step that bundles the server into the target format:

```bash
NITRO_PRESET=cloudflare_pages pnpm build
```

This produces a `dist/` directory with the platform-specific output (e.g., `dist/_worker.js/` for Cloudflare Pages).

## Setting the Preset

Use the `NITRO_PRESET` environment variable at build time:

```bash
NITRO_PRESET=cloudflare_pages agent-native build
```

Supported presets: `cloudflare_pages` (more coming soon).

## Node.js (Default)

No preset needed. Build and run:

```bash
agent-native build
agent-native start
```

Set `PORT` to configure the listen port (default: `3000`).

### Docker

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/build build
COPY --from=build /app/data data
ENV PORT=3000
EXPOSE 3000
CMD ["node", "build/server/index.js"]
```

## Cloudflare Pages

Set `NITRO_PRESET=cloudflare_pages` as a build environment variable in the Cloudflare dashboard.

**Build command:**

```bash
pnpm build
```

**Wrangler configuration** (`wrangler.toml`):

```toml
name = "my-app"
pages_build_output_dir = "dist"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]
```

**Database:** Cloudflare Workers can't use local SQLite. Use a remote database:

- **D1** — Cloudflare's native SQLite. Add a D1 binding in the dashboard or wrangler.toml.
- **Turso** — Set `DATABASE_URL` and `DATABASE_AUTH_TOKEN` as environment variables.

**Limitations on edge runtimes:**

Some features require Node.js and are automatically skipped on edge targets:

- **Agent chat** — requires child process spawning for scripts
- **Terminal** — requires PTY
- **File sync** — requires filesystem watchers

API routes, SSR, auth, and database access all work on edge runtimes.

## Environment Variables

Each platform has its own way to set environment variables:

- **Node.js** — `.env` file or shell exports
- **Cloudflare** — Dashboard settings or wrangler.toml secrets

Common variables:

| Variable              | Description                           |
| --------------------- | ------------------------------------- |
| `PORT`                | Server port (Node.js only)            |
| `NITRO_PRESET`        | Target platform (set at build time)   |
| `DATABASE_URL`        | Database connection URL               |
| `DATABASE_AUTH_TOKEN` | Database auth token (Turso)           |
| `ANTHROPIC_API_KEY`   | API key for embedded production agent |
| `FILE_SYNC_ENABLED`   | Enable file sync for multi-instance   |

## File Sync in Production

For multi-instance deployments (e.g., serverless or load-balanced), enable file sync to keep instances in sync:

```bash
FILE_SYNC_ENABLED=true
```

See [File Sync](/docs/file-sync) for adapter configuration (Firestore, Supabase, Convex).
