# Calendar — Development Guide

This guide is for development-mode agents editing this app's source code. For app operations and tools, see AGENTS.md.

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 18, React Router 6, TypeScript, Vite, TailwindCSS
- **Backend**: Nitro (via @agent-native/core)
- **UI components**: Radix UI + Lucide icons
- **Google Integration**: googleapis npm package
- **Database**: SQLite via Drizzle ORM + @libsql/client (local by default, cloud upgrade via `DATABASE_URL`)
- **State**: Settings in SQL via settings API, structured data in SQLite via Drizzle
- **Path aliases**: `@/*` → app/, `@shared/*` → shared/

## Project Structure

```
app/             # React SPA
  components/
    layout/      # AppLayout, Sidebar
    calendar/    # MonthView, WeekView, DayView, EventCard, EventDialog, etc.
    booking/     # DatePicker, TimeSlotPicker, BookingForm, BookingConfirmation
    ui/          # shadcn/ui components
  hooks/         # React Query hooks (use-events, use-bookings, etc.)
  pages/         # Route pages
server/          # Nitro API server
  routes/        # API route handlers
  lib/           # Google Calendar client, env config
  db/            # Drizzle schema + DB connection
shared/          # Shared TypeScript types
actions/         # Agent-callable scripts
data/            # SQLite database file (app.db)
```

## Framework Basics (Nitro + @agent-native/core)

This app uses **Nitro** (via `@agent-native/core`) for the server. All server code lives in `server/`.

### Server Directory

```
server/
  routes/     # File-based API routes (auto-discovered by Nitro)
  handlers/   # Route handler logic modules
  plugins/    # Server plugins — run at startup (SSE, auth)
  lib/        # Shared server modules (helpers)
```

### Adding an API Route

Create a file in `server/routes/api/`. The filename determines the URL path and HTTP method:

```
server/routes/api/items/index.get.ts    → GET  /api/items
server/routes/api/items/index.post.ts   → POST /api/items
server/routes/api/items/[id].get.ts     → GET  /api/items/:id
server/routes/api/items/[id].patch.ts   → PATCH /api/items/:id
```

Each file exports a default `defineEventHandler`:

```ts
export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  return { ok: true };
});
```

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

### SQLite (via Drizzle ORM + @libsql/client)

Structured data lives in SQLite (`data/app.db`):

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

Use `getDb()` from `server/db/index.ts` to get a Drizzle database instance. All queries are async. Set `DATABASE_URL` env var for cloud database (Turso); defaults to local `file:data/app.db`.

## Build & Dev Commands

```bash
pnpm dev          # Start dev server (client + server)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm test         # Run Vitest tests
pnpm action <name> [--args]  # Run a backend script
```

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).


## Tools (Framework Feature)

The framework provides **Tools** — mini sandboxed Alpine.js apps that run inside iframes. Tools let users (or the agent) create interactive widgets, dashboards, and utilities without modifying the app's source code. They appear in the sidebar under a "Tools" section.

- **Creating tools**: Via the sidebar "+" button, agent chat, or `POST /_agent-native/tools`
- **API calls**: Tools use `toolFetch()` which proxies requests through the server with `${keys.NAME}` secret injection
- **Styling**: Tools inherit the main app's Tailwind v4 theme automatically
- **Sharing**: Private by default, shareable with org or specific users (same model as other ownable resources)
- **Security**: Iframe sandbox + CSP + SSRF protection on the proxy

See the `tools` skill in `.agents/skills/tools/SKILL.md` for full implementation details.
