# Deployment

Agent-native apps can be deployed anywhere. Set `DATABASE_URL` for your database and optionally `NITRO_PRESET` for edge targets.

## Database

By default, apps use local SQLite (`file:./data/app.db`). For production, set `DATABASE_URL` to any supported provider:

| Provider           | `DATABASE_URL` format                                   |
| ------------------ | ------------------------------------------------------- |
| **SQLite** (local) | `file:./data/app.db` (default)                          |
| **Turso**          | `libsql://your-db.turso.io`                             |
| **Neon**           | `libsql://...` or use Neon's libsql-compatible endpoint |
| **Supabase**       | `libsql://...` via Supabase's libsql proxy              |
| **Cloudflare D1**  | No URL needed — uses the `DB` binding automatically     |

For Turso/Neon/Supabase, also set `DATABASE_AUTH_TOKEN`.

D1 is auto-detected when running on Cloudflare Workers with a D1 binding named `DB`.

## Node.js (Default)

```bash
pnpm build
pnpm start    # or: node build/server/index.js
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

## Cloudflare Workers

**Build command:**

```bash
NITRO_PRESET=cloudflare_pages pnpm build
```

**Wrangler configuration** (`wrangler.toml`):

```toml
name = "my-app"
main = "dist/_worker.js/index.js"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat_v2"]

[assets]
directory = "dist"

[[d1_databases]]
binding = "DB"
database_name = "my-app-db"
database_id = "<your-d1-database-id>"
```

**Deploy:**

```bash
npx wrangler deploy
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and other runtime secrets in the Cloudflare dashboard under Settings → Variables and Secrets.

**Edge runtime limitations** (automatically handled — no config needed):

- Agent chat and terminal are skipped (require Node.js)
- API routes, SSR, auth, and database all work

## Netlify

```bash
pnpm build
```

Deploy via `netlify deploy --prod` or connect your Git repo in the Netlify dashboard. Set environment variables in the Netlify dashboard.

## Environment Variables

| Variable              | Description                      |
| --------------------- | -------------------------------- |
| `PORT`                | Server port (Node.js only)       |
| `DATABASE_URL`        | Database connection URL          |
| `DATABASE_AUTH_TOKEN` | Database auth token (Turso/Neon) |
| `NITRO_PRESET`        | Edge target (build time only)    |
| `ANTHROPIC_API_KEY`   | API key for production agent     |
