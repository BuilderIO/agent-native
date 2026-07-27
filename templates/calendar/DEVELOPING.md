# Calendar — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 19, React Router 8, TypeScript, Vite, TailwindCSS
- **Backend**: Nitro (via @agent-native/core)
- **UI components**: Radix UI + Lucide icons
- **Google Integration**: googleapis npm package
- **Database**: Drizzle ORM over portable SQL (`DATABASE_URL`; local dev defaults to SQLite)
- **State**: Settings in SQL via settings API, structured data in SQL via Drizzle
- **Path aliases**: `@/*` → app/, `@shared/*` → shared/

## Project Structure

```
app/             # React SPA
  components/
    layout/      # AppLayout, Sidebar
    calendar/    # MonthView, WeekView, DayView, EventCard, EventDialog, etc.
    booking/     # DatePicker, TimeSlotPicker, BookingForm, BookingConfirmation
    ui/          # shadcn/ui components
  hooks/         # Action/query hooks (use-events, use-bookings, etc.)
  pages/         # Route pages
server/          # Nitro API server
  routes/        # Route-only handlers
  lib/           # Google Calendar client, env config
  db/            # Drizzle schema + DB connection
shared/          # Shared TypeScript types
actions/               # Shared app operations (defineAction; UI uses action hooks)
data/            # Local development database fallback
```

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

### SQL (via Drizzle ORM)

Structured data lives in SQL. Use `@agent-native/core/db/schema` helpers for schema and Drizzle's query builder for reads/writes so the same code runs across SQLite, Postgres, libSQL/Turso, D1, and other supported backends:

| Table      | Contents                                       |
| ---------- | ---------------------------------------------- |
| `bookings` | Incoming bookings from the public booking page |

### Settings (via `@agent-native/core/settings`)

Configuration lives in the SQL `settings` table, accessed via the settings API:

| Key                     | Contents                                     |
| ----------------------- | -------------------------------------------- |
| `calendar-settings`     | App settings (timezone, booking page config) |
| `calendar-availability` | Availability schedule configuration          |

### OAuth Tokens (via `@agent-native/core/oauth-tokens`)

Google OAuth tokens are stored in the SQL `oauth_tokens` table. Use the oauth-tokens API from `@agent-native/core/oauth-tokens` to read/write tokens — not JSON files.

### Database Access

Use `getDb()` from `server/db/index.ts` to get a Drizzle database instance. All queries are async. Local development defaults to `file:./data/app.db`; deployed apps need a persistent `DATABASE_URL` so data survives container/serverless restarts. Turso is optional, not required. Common choices include Neon, Supabase, Turso/libSQL, plain Postgres, durable SQLite, D1 bindings, and Builder.io-managed environments when available.

## Build & Dev Commands

```bash
pnpm dev          # Start dev server (client + server)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm test         # Run Vitest tests
pnpm action <name> [--args]  # Run an action
```

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
