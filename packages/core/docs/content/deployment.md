---
title: "Deployment"
description: "Deploy agent-native apps to any platform with Nitro presets — Node.js, Vercel, Netlify, Cloudflare, AWS, and more."
---

# Deployment

Agent-native apps use [Nitro](https://nitro.build) under the hood, which means you can deploy to any platform with zero config changes — just set a preset.

## Workspace Deploy: One Origin, Many Apps {#workspace-deploy}

If your project is a [workspace](/docs/multi-app-workspace), you can ship every app in it to a single origin with one command:

```bash
agent-native deploy
# https://your-agents.com/mail/*       → apps/mail
# https://your-agents.com/calendar/*   → apps/calendar
# https://your-agents.com/forms/*      → apps/forms
```

Each app is built with `APP_BASE_PATH=/<name>` and `VITE_APP_BASE_PATH=/<name>`, then packaged into `dist/<name>/`. Cloudflare Pages is the default preset and uses a generated dispatcher worker at `dist/_worker.js`; Netlify uses one function per app in `.netlify/functions-internal/<app>-server` plus generated redirects.

Same-origin deploy gives you two big wins for free:

- **Shared login session** — log into any app, every app is logged in.
- **Zero-config cross-app A2A** — tagging `@calendar` from mail is a same-origin fetch; no CORS, no JWT signing between siblings.

Publish the output with:

```bash
wrangler pages deploy dist
```

For Netlify unified deploys, use the Netlify preset:

```bash
agent-native deploy --preset netlify
```

Generated workspaces include a root `netlify.toml` that runs `agent-native deploy --preset netlify --build-only`, publishes `dist`, and points Netlify at `.netlify/functions-internal`.

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

For a workspace, deploy every app from one Netlify site by running:

```bash
agent-native deploy --preset netlify
```

The workspace build writes static assets to `dist/<app>/` and routes each app to its own Netlify function without forced redirects, so files like `/mail/assets/...` are served statically before the server function handles app routes.

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

| Variable              | Description                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `PORT`                | Server port (Node.js only)                                                                                           |
| `NITRO_PRESET`        | Override build preset at build time                                                                                  |
| `APP_BASE_PATH`       | Mount the app under a prefix (e.g. `/mail`). Set automatically by `agent-native deploy`; leave unset for standalone. |
| `DATABASE_URL`        | Postgres / Turso / SQLite connection string. Required in production.                                                 |
| `DATABASE_AUTH_TOKEN` | Auth token for Turso / libsql connections.                                                                           |

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

| Variable                       | Description                                                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACCESS_TOKEN`                 | Single shared token for simple production deploys (alternative to Better Auth).                                                                                                               |
| `ACCESS_TOKENS`                | Comma-separated list of access tokens.                                                                                                                                                        |
| `AUTH_MODE`                    | `local` skips auth entirely (`local@localhost` identity). For dev/single-tenant only; never set in real prod.                                                                                 |
| `AUTH_SKIP_EMAIL_VERIFICATION` | Skip email verification for QA accounts. Local dev/test skips by default; hosted deploys must set this explicitly. **Disables a real security control** — only use on hosted QA environments. |
| `GOOGLE_CLIENT_ID`             | Google OAuth client ID. Auto-enables "Sign in with Google" in Better Auth.                                                                                                                    |
| `GOOGLE_CLIENT_SECRET`         | Google OAuth client secret.                                                                                                                                                                   |
| `GITHUB_CLIENT_ID`             | GitHub OAuth client ID.                                                                                                                                                                       |
| `GITHUB_CLIENT_SECRET`         | GitHub OAuth client secret.                                                                                                                                                                   |

### Inbound Webhooks {#env-webhooks}

Inbound webhook handlers refuse forged requests when their signing secret is missing in production (was previously fail-open with a warning — see CHANGELOG / [security audit fixes](#security-config)).

| Variable                        | Required when                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `EMAIL_INBOUND_WEBHOOK_SECRET`  | Inbound email integration is enabled. Verifies Resend / SendGrid / Svix signatures.                            |
| `TELEGRAM_WEBHOOK_SECRET`       | Telegram bot integration is enabled.                                                                           |
| `WHATSAPP_APP_SECRET`           | WhatsApp Business integration is enabled.                                                                      |
| `WHATSAPP_VERIFY_TOKEN`         | WhatsApp webhook verification handshake (set in your Meta app dashboard too).                                  |
| `SLACK_SIGNING_SECRET`          | Slack integration is enabled. Verifies Slack request signatures.                                               |
| `RECALL_WEBHOOK_SECRET`         | Calls / Recall.ai integration is enabled.                                                                      |
| `DEEPGRAM_WEBHOOK_SECRET`       | Calls / Deepgram transcription webhook is enabled.                                                             |
| `ZOOM_WEBHOOK_SECRET`           | Calls / Zoom integration is enabled.                                                                           |
| `GOOGLE_DOCS_PUSH_AUDIENCE`     | Google Docs Pub/Sub push integration is enabled. Set to the public URL of your push endpoint.                  |
| `GOOGLE_DOCS_PUSH_SIGNER_EMAIL` | Google Docs Pub/Sub push integration is enabled. Set to the Pub/Sub service account email.                     |
| `GMAIL_WATCH_TOPIC`             | Gmail Pub/Sub push (mail template). Optional — disables push if unset and falls back to history-delta polling. |
| `GMAIL_PUSH_AUDIENCE`           | Gmail Pub/Sub push audience.                                                                                   |
| `GMAIL_PUSH_SIGNER_EMAIL`       | Gmail Pub/Sub push signer email.                                                                               |

For local development of any of these integrations, set `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS=1` to opt back into the old "warn and accept" behavior — never set this in prod.

### Security Configuration (Opt-in) {#security-config}

Defaults are strict; these flags relax behavior. Don't set them unless you specifically want the relaxed path.

| Variable                                 | Effect                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENT_NATIVE_DEBUG_ERRORS`              | `=1` to include stack traces in 500 JSON responses. Useful on previews; do **not** set in real prod (was previously gated by `NODE_ENV !== "production"`, which leaked stacks on misconfigured deploys).                                                                                                         |
| `AGENT_NATIVE_ALLOW_UNVERIFIED_WEBHOOKS` | `=1` to accept webhooks without their signing secret (local dev only). Defaults to fail-closed in production.                                                                                                                                                                                                    |
| `AGENT_NATIVE_KEYS_WORKSPACE_FALLBACK`   | `=1` to let `${keys.NAME}` resolution in tools/automations fall through user-scope → workspace-scope. Default off (user-scope only) — a malicious org member could otherwise plant a workspace `OPENAI_API_KEY` and harvest other members' calls. Turn on only if your org genuinely shares workspace-wide keys. |
| `AGENT_NATIVE_MCP_HUB_MULTI_ORG`         | `=1` to allow `AGENT_NATIVE_MCP_HUB_TOKEN` to serve multiple orgs from a single hub deployment. Default refuses to serve when more than one org exists in a hub deploy. Only relevant if you operate the workspace MCP hub.                                                                                      |
| `AGENT_NATIVE_ALLOW_ENV_VAR_WRITES`      | `=1` to let runtime code mutate `process.env` from the env-var write API. Off by default — required to be explicitly enabled outside dev SQLite.                                                                                                                                                                 |
| `AUTH_SKIP_EMAIL_VERIFICATION`           | `=1` to skip email verification for password signups. Local dev/test skips by default; hosted deploys should use this only for QA — see Auth section above.                                                                                                                                                      |

### Workspace .env Inheritance {#env-inheritance}

Inside a workspace, the root `.env` is loaded into every app automatically, so shared keys like `ANTHROPIC_API_KEY`, `A2A_SECRET`, `BETTER_AUTH_SECRET`, and `OAUTH_STATE_SECRET` only need to be set once. Per-app `apps/<name>/.env` wins on conflict.

### Generating Strong Secrets {#env-generate-secrets}

For any secret marked "32+ char random" (`BETTER_AUTH_SECRET`, `OAUTH_STATE_SECRET`, `A2A_SECRET`, `SECRETS_ENCRYPTION_KEY`), generate fresh values with:

```bash
openssl rand -hex 32
```

Rotate them by replacing the env var on every instance and redeploying — sessions / OAuth state envelopes signed under the old key become invalid, so users may need to sign in again.

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
