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

…or set `NITRO_PRESET=netlify` at build time.

## Cloudflare Pages {#cloudflare-pages}

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "cloudflare_pages" },
});
```

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
| `APP_BASE_PATH`     | Mount the app under a prefix (e.g. `/mail`). Set automatically by `agent-native deploy`; leave unset for standalone. |

Inside a workspace, the root `.env` is loaded into every app automatically, so shared keys like `ANTHROPIC_API_KEY` and `A2A_SECRET` only need to be set once. Per-app `apps/<name>/.env` wins on conflict.

## Updating UI in Production {#updating-ui-in-production}

One of agent-native's core features is that the agent can modify your app's source code — components, routes, styles, actions. During local development this works seamlessly because the agent has full filesystem access.

In a standard production deployment, however, the agent runs in **production mode** with access to app tools (actions, database, MCP) but **not** the filesystem. This means the agent can read and write data, run actions, and interact with external services — but it can't edit your React components or add new routes on a deployed instance.

### Builder.io: Visual Editing in Production {#builderio}

[Builder.io](https://www.builder.io) solves this by providing a managed cloud environment where the agent retains the ability to modify your app's UI in production. Connect your repo to Builder.io and prompt for UI changes directly — no redeploy needed.

**How it works:**

1. Connect your agent-native repo to Builder.io
2. Builder.io provides a cloud frame with the agent, visual editing, and real-time collaboration
3. Prompt the agent to make UI changes — it edits your components, routes, and styles live
4. Changes are committed back to your repo

See [Frames](/docs/frames) for more on the embedded agent panel vs. cloud frame options.

## Multi-instance deploys {#multi-instance}

Agent-native apps store all state in SQL via Drizzle and sync the UI via [polling](/docs/key-concepts#polling-sync) against the database — no file-system state, no sticky sessions, no in-memory caches. That means multi-instance and serverless deployments work out of the box: point every instance at the same `DATABASE_URL` and they converge automatically. See [Key Concepts — Data in SQL](/docs/key-concepts#data-in-sql) and [Portability](/docs/key-concepts#hosting-agnostic).
