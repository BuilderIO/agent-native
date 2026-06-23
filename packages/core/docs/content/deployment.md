---
title: "Deployment"
description: "Deploy agent-native apps to any platform with Nitro presets — Node.js, Vercel, Netlify, Cloudflare, AWS, and more."
---

# Deployment

Agent-native apps use [Nitro](https://nitro.build) under the hood, which means you can deploy to any platform with zero config changes — just set a preset.

## Before You Deploy: Pick a Persistent Database {#persistent-database}

Every deployed app needs a persistent SQL database. In local development, agent-native falls back to a SQLite file at `data/app.db`; that is convenient on your machine, but it is not durable in containers, previews, or serverless environments where the filesystem can be reset.

Set `DATABASE_URL` in your deploy provider before promoting an app to production. Agent-native uses Drizzle for schema and queries, so the data layer is portable across Drizzle-compatible SQL backends and the framework auto-detects the dialect from the URL. See [Database](/docs/database#production) for the adapter list and dialect details.

Use `DATABASE_AUTH_TOKEN` only when your database provider requires a separate token, such as Turso/libSQL. For workspaces, all apps inherit the root `DATABASE_URL` by default; set `<APP_NAME>_DATABASE_URL` when one app should use a different database.

## Workspace Deploy: One Origin, Many Apps {#workspace-deploy}

If your project is a [workspace](/docs/multi-app-workspace), you can ship every app in it to a single origin with one command:

```bash
npx @agent-native/core@latest deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Each app is built with `APP_BASE_PATH=/<name>` and `VITE_APP_BASE_PATH=/<name>`, then packaged for the target Nitro preset. Cloudflare Pages is the default preset and uses a generated dispatcher worker at `dist/_worker.js`; Netlify uses one function per app in `.netlify/functions-internal/<app>-server` plus generated redirects; Vercel writes a workspace-level `.vercel/output` using the Build Output API.

```an-diagram title="One origin, many apps" summary="Each workspace app is built with its own base path and mounted under a path prefix on a single origin — so login and cross-app A2A are same-origin and free."
{
  "html": "<div class=\"diagram-ws\"><div class=\"diagram-panel\" data-rough><strong>https://your-agents.com</strong><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/mail/*</span><small class=\"diagram-muted\">apps/mail</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/calendar/*</span><small class=\"diagram-muted\">apps/calendar</small></div><div class=\"diagram-row\"><span class=\"diagram-pill accent\">/forms/*</span><small class=\"diagram-muted\">apps/forms</small></div></div><div class=\"diagram-col wins\"><span class=\"diagram-pill ok\">shared login session</span><span class=\"diagram-pill ok\">zero-config cross-app A2A</span></div></div>",
  "css": ".diagram-ws{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.diagram-ws .diagram-panel{display:flex;flex-direction:column;gap:6px;padding:14px 16px}.diagram-ws .diagram-row{display:flex;align-items:center;gap:8px}.diagram-ws .wins{display:flex;flex-direction:column;gap:8px;align-items:flex-start}"
}
```

Same-origin deploy gives you two big wins for free:

- **Shared login session** — log into any app, every app is logged in.
- **Zero-config cross-app A2A** — tagging `@calendar` from mail is a same-origin fetch; no CORS, no JWT signing between siblings.

Publish the output with:

```bash
wrangler pages deploy dist
```

For Netlify unified deploys, use the Netlify preset:

```bash
npx @agent-native/core@latest deploy --preset netlify
```

For Vercel unified deploys, use the Vercel preset:

```bash
npx @agent-native/core@latest deploy --preset vercel
```

When configuring a provider build command, use the same command with `--build-only`. Vercel should run `npx @agent-native/core@latest deploy --preset vercel --build-only`; the command writes `.vercel/output` directly, so no `vercel.json` is required for workspace routing.

Hosted workspace builds require `A2A_SECRET` in the deploy provider environment.
This makes Slack, inbound webhooks, and cross-app A2A resume work through signed
background processors. Local `--build-only` artifact checks still run without it.

Per-app independent deploy is still supported — just `cd apps/<name> && npx @agent-native/core@latest build` like a standalone scaffold.

## How It Works {#how-it-works}

When you run `npx @agent-native/core@latest build`, Nitro builds both the client SPA and the server API into `.output/`:

```an-file-tree title="Build output"
{
  "entries": [
    { "path": ".output/", "note": "self-contained — copy to any environment and run" },
    { "path": ".output/public/", "note": "built SPA (static assets)" },
    { "path": ".output/server/index.mjs", "note": "server entry point" },
    { "path": ".output/server/chunks/", "note": "server code chunks" }
  ]
}
```

The output is self-contained — copy `.output/` to any environment and run it.

```an-diagram title="Build to deploy" summary="One source tree builds to a Nitro preset; the same self-contained output runs on Node, Vercel, Netlify, Cloudflare, AWS, or Deno. Every instance points at the same persistent DATABASE_URL."
{
  "html": "<div class=\"diagram-deploy\"><div class=\"diagram-box\" data-rough>App source</div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-panel center\" data-rough><span class=\"diagram-pill accent\">build</span><small class=\"diagram-muted\">Nitro preset</small></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-grid\"><span class=\"diagram-pill\">Node.js</span><span class=\"diagram-pill\">Vercel</span><span class=\"diagram-pill\">Netlify</span><span class=\"diagram-pill\">Cloudflare</span><span class=\"diagram-pill\">AWS Lambda</span><span class=\"diagram-pill\">Deno</span></div><div class=\"diagram-arrow diagram-muted\" aria-hidden=\"true\">&rarr;</div><div class=\"diagram-box\" data-rough>Persistent DATABASE_URL<br><small class=\"diagram-muted\">shared by every instance</small></div></div>",
  "css": ".diagram-deploy{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.diagram-deploy .center{display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 16px}.diagram-deploy .diagram-arrow{font-size:22px;line-height:1}.diagram-deploy .diagram-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}"
}
```

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
NITRO_PRESET=netlify npx @agent-native/core@latest build
```

## Node.js (Default) {#nodejs}

The default preset. Build and run:

```bash
npx @agent-native/core@latest build
node .output/server/index.mjs
```

Set `PORT` to configure the listen port (default: `3000`).

Use the current Node.js LTS line for production deploys. As of May 2026, that
is Node.js 24; Node.js 20 reached end-of-life on April 30, 2026 and no longer
receives upstream security updates.

### Docker {#docker}

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app/.output .output
# data/ is a runtime-created SQLite directory — do not copy a dev DB into prod.
# For production, set DATABASE_URL to a hosted Postgres or Turso instance.
RUN mkdir -p /app/data
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

For a workspace, build every app into one Vercel Build Output API bundle:

```bash
npx @agent-native/core@latest deploy --preset vercel
```

For Vercel Git deployments, set the build command to:

```bash
npx @agent-native/core@latest deploy --preset vercel --build-only
```

The workspace build copies each app's Nitro `vercel` output into the root `.vercel/output`, gives each function its own mount-path environment, and writes the route config that serves apps at `/<app-id>`.

## Netlify {#netlify}

The Nitro `netlify` preset works well and, in practice, has given us much faster cold starts than Cloudflare Pages (~200ms TTFB vs ~9s) for templates that talk to external Postgres (Neon). Either set the preset in `vite.config.ts`:

```ts
// vite.config.ts
export default defineConfig({
  nitro: { preset: "netlify" },
});
```

…or set `NITRO_PRESET=netlify` at build time.

For a workspace, deploy every app from one Netlify site by running:

```bash
npx @agent-native/core@latest deploy --preset netlify
```

The workspace build writes static assets under `dist/_workspace_static/` and routes each app to its own Netlify function without forced asset redirects, so files like `/mail/assets/...` are served statically before the server function handles app routes.

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

### Build / Runtime {#env-runtime}

| Variable                    | Description                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | Server port (Node.js only)                                                                                                                        |
| `NITRO_PRESET`              | Override build preset at build time                                                                                                               |
| `APP_BASE_PATH`             | Mount the app under a prefix (e.g. `/mail`). Set automatically by `npx @agent-native/core@latest deploy`; leave unset for standalone.             |
| `AGENT_PROD_CODE_EXECUTION` | Optional production code-execution mode: `off` (default), `sandboxed`, or `trusted`. See [Production Code Execution](#production-code-execution). |

Database connection variables (`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, per-app `<APP_NAME>_DATABASE_URL`) live in [Database](/docs/database#production).

### Required in Production {#env-required-prod}

These must be set before promoting an app to a real prod deploy. Missing values either fail-closed (the framework refuses to start / refuses to handle requests) or fall back to weaker behavior with a loud warning.

| Variable                 | Description                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | 32+ char random string. Signs session cookies AND is the fallback HMAC for `OAUTH_STATE_SECRET` and `SECRETS_ENCRYPTION_KEY`. Hard-required: the framework throws on startup if missing in production.                                            |
| `BETTER_AUTH_URL`        | Public origin of this app (e.g. `https://mail.example.com`). Used for cookie domain and OAuth redirect construction.                                                                                                                              |
| `ANTHROPIC_API_KEY`      | API key for the embedded production agent. **In multi-tenant deploys**, the framework refuses to fall back to this when the user has no per-user key — bring-your-own-key is required. Single-tenant self-hosted installs use it as a global key. |
| `OAUTH_STATE_SECRET`     | Dedicated HMAC key for OAuth state envelopes (Google, Atlassian, Zoom). Falls back to `BETTER_AUTH_SECRET` when unset, but a dedicated value is recommended so rotating one doesn't invalidate the other. Generate via `openssl rand -hex 32`.    |
| `A2A_SECRET`             | Shared HMAC for inter-app A2A JSON-RPC. Without it, every A2A endpoint and the `/_agent-native/integrations/process-task` self-fire endpoint return 503 in production.                                                                            |
| `SECRETS_ENCRYPTION_KEY` | AES-256-GCM key for the encrypted-at-rest secrets vault. Falls back to `BETTER_AUTH_SECRET`. Hard-fails in production when both are unset.                                                                                                        |

### Auth & Identity {#env-auth}

OAuth provider credentials (Google, GitHub), static MCP bearer fallbacks (`ACCESS_TOKEN` / `ACCESS_TOKENS`), and email-verification toggles are documented in [Authentication](/docs/authentication). Set them there per the auth mode you choose.

### Inbound Webhooks {#env-webhooks}

Each messaging integration requires its own signing secret in production (handlers fail-closed on forged requests when the secret is missing). The per-integration variables are listed in [Messaging](/docs/messaging) and [Security](/docs/security). For local development only, `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` opts back into "warn and accept" — never set it in prod.

### Security Configuration (Opt-in) {#security-config}

Defaults are strict. A handful of opt-in flags relax behavior (debug stack traces, unverified webhooks, workspace-scoped key fallback, the MCP hub multi-org switch, runtime env-var writes). They are documented with their security trade-offs in [Security](/docs/security). Don't set them unless you specifically want the relaxed path.

### Workspace .env Inheritance {#env-inheritance}

Inside a workspace, the root `.env` is loaded into every app automatically, so shared keys like `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET`, and `OAUTH_STATE_SECRET` only need to be set once. Per-app `apps/<name>/.env` wins on conflict.

### Generating Strong Secrets {#env-generate-secrets}

For any secret marked "32+ char random" (`BETTER_AUTH_SECRET`, `OAUTH_STATE_SECRET`, `A2A_SECRET`, `SECRETS_ENCRYPTION_KEY`), generate fresh values with:

```bash
openssl rand -hex 32
```

Rotate them by replacing the env var on every instance and redeploying — sessions / OAuth state envelopes signed under the old key become invalid, so users may need to sign in again.

## Production Agent Tools {#production-agent-tools}

Production agents get the app's registered actions plus framework tools from
the agent chat plugin. Database writes are enabled by default because raw DB
tools are scoped to the authenticated user/org, but app owners can narrow the
surface when a deployment should be more opinionated:

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  // Default: "write" (also true)
  databaseTools: "read", // "write" | "read" | "off"
  extensionTools: false,
});
```

- `databaseTools: "write"` — default. Registers `db-schema`, `db-query`,
  `db-exec`, and `db-patch`. Writes are scoped to the current user/org and
  schema changes are blocked.
- `databaseTools: "read"` — registers only `db-schema` and `db-query`; agents
  inspect data with SQL but must use typed app actions for writes.
- `databaseTools: "off"` or `false` — removes raw database tools from the
  agent surface so the app's actions are the only data access path.
- `extensionTools: false` — removes framework extension-management actions and
  prompt guidance (`create-extension`, `update-extension`, etc.) for apps that
  do not want the agent creating sandboxed mini-apps.

## Production Code Execution {#production-code-execution}

By default, production agents run without code-execution tools. They can call app actions, database tools, MCP tools, browser/session tools, and other registered framework tools, but they do not get shell or filesystem access.

Node-compatible deployments can opt into production code execution through the agent chat plugin or an environment override:

```ts
// server/plugins/agent-chat.ts
export default createAgentChatPlugin({
  codeExecution: { production: "sandboxed" },
});
```

The available modes are:

- `off` — the default. No code-execution tools are registered in production.
- `sandboxed` — registers `run-code`, an isolated Node.js JavaScript runner with a scrubbed environment, a fresh temp directory, output/time limits, and a localhost bridge to allowlisted registered tools such as `provider-api-request`, `provider-api-docs`, `provider-api-catalog`, `web-request`, and the Resources-backed workspace file bridge used by `workspaceRead` / `workspaceWrite`.
- `trusted` — registers `run-code` plus the full coding tool registry (`bash`, `read`, `edit`, `write`). Use this only for single-tenant or operator-controlled deployments where full shell access to the host is intentional.

Set `AGENT_PROD_CODE_EXECUTION=sandboxed` or `AGENT_PROD_CODE_EXECUTION=trusted` to override the plugin option for a specific deployment without a code change. `AGENT_PROD_CODE_EXECUTION=off` forces code execution off even when the plugin option enables it.

The `run-code` sandbox is process-level isolation, not an OS container. It strips app secrets from the child process environment and uses the Node permission model when available, but outbound network is not blocked by Node itself; authenticated calls should go through the bridge helpers the tool exposes.

## Updating UI in Production {#updating-ui-in-production}

One of agent-native's core features is that the agent can modify your app's source code — components, routes, styles, actions. During local development this works seamlessly because the agent has full filesystem access.

In a standard production deployment with [production code execution](#production-code-execution) left off, the agent has access to app tools (actions, database, MCP) but not the filesystem. This means the agent can read and write data, run actions, and interact with external services — but it can't edit your React components or add new routes on a deployed instance.

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
