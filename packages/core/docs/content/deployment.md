---
title: "Deployment"
description: "Deploy agent-native apps to any platform with Nitro presets — Node.js, Vercel, Netlify, Cloudflare, AWS, and more."
---

# Deployment

Agent-native apps use [Nitro](https://nitro.build) under the hood, which means you can deploy to any platform with zero config changes — just set a preset.

## Workspace Deploy: One Origin, Many Apps {#workspace-deploy}

If your project is a [workspace](/docs/enterprise-workspace), you can ship every app in it to a single origin with one command:

```bash
agent-native deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Each app is built with `APP_BASE_PATH=/<name>`, packaged into `dist/<name>/`, and fronted by a generated dispatcher worker at `dist/_worker.js`. A `_routes.json` manifest tells Cloudflare Pages which paths are dynamic.

Same-origin deploy gives you two big wins for free:

- **Shared login session** — log into any app, every app is logged in.
- **Zero-config cross-app A2A** — tagging `@calendar` from mail is a same-origin fetch; no CORS, no JWT signing between siblings.

Publish the output with:

```bash
wrangler pages deploy dist
```

Only need to deploy to Cloudflare Pages? That's the out-of-the-box target. Other targets stay per-app (see below) — or file an issue if you want another unified preset.

Per-app independent deploy is still supported — just `cd apps/<name> && agent-native build` like a standalone scaffold.

## How It Works {#how-it-works}

When you run `agent-native build`, Nitro builds both the client SPA and the server API into `.output/`:

```text
.output/
  public/          # Built SPA (static assets)
  server/
    index.mjs      # Server entry point
    chunks/         # Server code chunks
```

The output is self-contained — copy `.output/` to any environment and run it.

## Setting the Preset {#setting-the-preset}

By default, Nitro builds for Node.js. To target a different platform, set the preset in your `vite.config.ts`:

```ts
import { defineConfig } from "@agent-native/core/vite";

export default defineConfig({
  nitro: {
    preset: "vercel",
  },
});
```

Or use the `NITRO_PRESET` environment variable at build time:

```bash
NITRO_PRESET=netlify agent-native build
```

## Node.js (Default) {#nodejs}

The default preset. Build and run:

```bash
agent-native build
node .output/server/index.mjs
```

Set `PORT` to configure the listen port (default: `3000`).

### Docker {#docker}

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-slim
WORKDIR /app
COPY --from=build /app/.output .output
COPY --from=build /app/data data
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

## Vercel {#vercel}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "vercel" },
});
```

Deploy via the Vercel CLI or git push:

```bash
vercel deploy
```

## Netlify {#netlify}

The Nitro `netlify` preset works well and, in practice, has given us much faster cold starts than Cloudflare Pages (~200ms TTFB vs ~9s) for templates that talk to external Postgres (Neon). Either set the preset in `vite.config.ts`:

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "netlify" },
});
```

…or set `NITRO_PRESET=netlify` at build time from `netlify.toml` (recommended for monorepo templates — keeps the preset scoped to the deploy rather than hard-coded in the template's Vite config).

### Monorepo template pattern {#netlify-monorepo}

For a workspace template at `templates/<name>/`, commit a `netlify.toml` at the template's root. All paths are **repo-root-relative** (Netlify's `base` should stay empty — the whole repo is the build context so pnpm workspace resolution works):

```toml
# templates/<name>/netlify.toml
[build]
  command = "pnpm install && NITRO_PRESET=netlify pnpm --filter <name> build"
  publish = "templates/<name>/dist"
  functions = "templates/<name>/.netlify/functions-internal"

[build.environment]
  NITRO_PRESET = "netlify"
```

Notes:

- `.netlify/functions-internal` is where Nitro 3 writes its server functions — Netlify picks them up from there.
- When you create a new Netlify site via the dashboard, its monorepo auto-detect sometimes picks the wrong template (e.g. selecting `templates/calendar` when you wanted `templates/<name>`). Manually clear the base directory and let `netlify.toml` drive the build.
- Do not put `netlify.toml` at the repo root — each template manages its own.

### Always build on Netlify CI {#netlify-ci-only}

**Do not run `netlify deploy --prod` from your Mac.** The framework's Nitro build (`createDanglingOptionalDepStubs()` in `packages/core/src/deploy/build.ts`) stubs platform-specific optional native deps that aren't installed on the current OS. On macOS, that stubs out the Linux `libsql` binaries; on Netlify's Linux runtime the server function then crashes with:

```
Cannot find module '@libsql/linux-x64-gnu'
```

Letting Netlify CI run the build fixes this — on Linux, pnpm installs the real binary and the stub creator skips it. Push to the branch connected to the Netlify site and let it build.

### Env vars {#netlify-env}

From the template directory, link the site and import `.env`:

```bash
cd templates/<name>
netlify link --name <netlify-site-name>
netlify env:import .env
```

Then set deployment-only vars that aren't in `.env`:

```bash
netlify env:set BETTER_AUTH_URL https://<your-domain>
netlify env:set BETTER_AUTH_SECRET "$(openssl rand -hex 32)"
netlify env:set NITRO_PRESET netlify
```

`BETTER_AUTH_URL` must match the public URL the app is served on (custom domain or `<site>.netlify.app`). `BETTER_AUTH_SECRET` should be a fresh 32-byte hex — do not reuse the dev secret.

## Cloudflare Pages {#cloudflare-pages}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "cloudflare_pages" },
});
```

### External Postgres latency {#cloudflare-hyperdrive}

Cloudflare Workers open a fresh connection per request. Against external Postgres (Neon, Supabase, RDS) the TLS + auth handshake dominates every cold hit, which is why we've seen ~9s TTFB on cold-start routes that query the DB.

Mitigate with [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/), which pools Postgres connections at the edge. Requires a TCP-based driver — `pg`, `postgres`, or Drizzle's `node-postgres` adapter. The HTTP-based `@neondatabase/serverless` driver does not go through Hyperdrive. Workers Paid plan only.

If you're hitting this and don't want to move to Hyperdrive, the Netlify preset above is a simpler path.

## AWS Lambda {#aws-lambda}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "aws_lambda" },
});
```

## Deno Deploy {#deno-deploy}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "deno_deploy" },
});
```

## Environment Variables {#environment-variables}

| Variable            | Description                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PORT`              | Server port (Node.js only)                                                                                           |
| `NITRO_PRESET`      | Override build preset at build time                                                                                  |
| `ACCESS_TOKEN`      | Enable auth gating for production mode                                                                               |
| `ANTHROPIC_API_KEY` | API key for embedded production agent                                                                                |
| `FILE_SYNC_ENABLED` | Enable file sync for multi-instance                                                                                  |
| `APP_BASE_PATH`     | Mount the app under a prefix (e.g. `/mail`). Set automatically by `agent-native deploy`; leave unset for standalone. |

Inside a workspace, the root `.env` is loaded into every app automatically, so shared keys like `ANTHROPIC_API_KEY` and `A2A_SECRET` only need to be set once. Per-app `apps/<name>/.env` wins on conflict.

## File Sync in Production {#file-sync}

By default, agent-native apps store state in local files. For multi-instance deployments (e.g., serverless or load-balanced), enable file sync to keep instances in sync:

```bash
FILE_SYNC_ENABLED=true
```

See [File Sync](/docs/file-sync) for adapter configuration (Firestore, Supabase, Convex).
