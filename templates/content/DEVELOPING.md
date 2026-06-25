# Documents — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 19, React Router, TypeScript, Vite, TailwindCSS
- **Backend**: Nitro (via @agent-native/core)
- **Database**: Drizzle ORM over portable SQL (`DATABASE_URL`; local dev defaults to SQLite)
- **UI**: Radix UI + Lucide icons + shadcn/ui
- **Path aliases**: `@/*` → app/, `@shared/*` → shared/

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

### Server Directory

```
server/
  routes/     # File-based route-only endpoints (auto-discovered by Nitro)
  handlers/   # Route handler logic modules
  plugins/    # Server plugins — run at startup (SSE, auth)
  lib/        # Shared server modules (helpers)
```

### Adding App Data

Normal app data starts as an action, not a custom route. Add `actions/<verb>-<resource>.ts` with `defineAction`, mark reads with `http: { method: "GET" }`, and call reads/writes from React with `useActionQuery` / `useActionMutation` from `@agent-native/core/client`. This keeps the UI and agent on one contract and lets mutating actions refresh action-backed queries automatically.

### Adding a Route-Only Endpoint

Use `server/routes/api/` only for protocols that cannot be modeled as JSON actions: multipart uploads, streaming/SSE/WebSocket, webhooks, OAuth callbacks/redirects, public SEO/OG endpoints, or binary/static asset serving. Do not add `/api/*` routes for normal CRUD, data queries, or pass-through wrappers around actions; the action endpoint already exists at `/_agent-native/actions/:name`.

Each route-only endpoint still exports a default `defineEventHandler`, but keep shared app logic in actions or server libraries so agent and UI behavior do not fork.

### Server Plugins

Startup logic (SSE, auth) lives in `server/plugins/`. Use `defineNitroPlugin` from core:

```ts
import { defineNitroPlugin } from "@agent-native/core";

export default defineNitroPlugin(async (nitroApp) => {
  // Runs once at server startup
});
```

### Key Imports from `@agent-native/core`

| Import                                       | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `defineNitroPlugin`                          | Define a server plugin (re-exported from Nitro)   |
| `createSSEHandler`                           | Create SSE endpoint for real-time updates         |
| `defineEventHandler`, `readBody`, `getQuery` | H3 route handler utilities (re-exported)          |
| `sendToAgentChat`                            | Send messages to agent from UI (client-side)      |
| `agentChat`                                  | Send messages to agent from scripts (server-side) |

| Import (settings)             | Purpose                              |
| ----------------------------- | ------------------------------------ |
| `getSetting` / `putSetting`   | Read/write app settings in SQL       |
| `getAppState` / `putAppState` | Read/write ephemeral UI state in SQL |

## Database Schema

```sql
documents (
  id TEXT PRIMARY KEY,
  parent_id TEXT,                 -- null = root page
  title TEXT NOT NULL DEFAULT 'Untitled',
  content TEXT NOT NULL DEFAULT '',  -- markdown
  icon TEXT,                      -- emoji
  position INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

## Build & Dev Commands

```bash
pnpm dev          # Start dev server (client + server)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm test         # Run Vitest tests
pnpm action <name> [--args]  # Run an action
```

## Builder CMS credentials (local dev)

Builder CMS source reads/writes need credentials. There are two ways to provide them:

1. **Connect per user (the real path):** a signed-in user connects their Builder
   account, which stores user-scoped credentials in the `app_secrets` store. The
   credential gate honors these for any runtime. This is what production uses.
2. **Local dogfooding escape hatch:** to run the app locally without connecting
   first, set the keys plus an explicit opt-in flag:
   ```bash
   # templates/content/.env or .env.local
   # The action CLI and Vite load the template cwd env files; workspace-root
   # env files can also be loaded by the surrounding dev/runtime commands.
   BUILDER_PRIVATE_KEY=...
   BUILDER_PUBLIC_KEY=...
   AGENT_NATIVE_LOCAL_BUILDER_ENV=1   # opt in to env-key fallback for a signed-in user
   ```
   Without `AGENT_NATIVE_LOCAL_BUILDER_ENV`, env-level Builder keys are
   intentionally **not** used for a signed-in user under the workspace runtime
   (so a deploy key can't impersonate a user across tenants). The flag is a
   non-production-only escape hatch; it has no effect when `NODE_ENV=production`.

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Extensions (Framework Feature)

The framework provides **Extensions** — mini sandboxed Alpine.js apps that run inside iframes. Extensions let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under an "Extensions" section. (Distinct from LLM tools — the function-calling primitives the agent invokes.)

- **Creating extensions**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/extensions`
- **API calls**: Extensions use `extensionFetch()` (legacy alias `toolFetch`) which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Extensions inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `extensions` skill in `.agents/skills/extensions/SKILL.md` for full implementation details.
