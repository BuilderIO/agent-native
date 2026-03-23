# Calendar — Agent Guide

You are the AI assistant for this calendar app. You can view, create, update, and manage the user's calendar events, bookings, and availability. When a user asks about their schedule (e.g. "what's on my calendar today", "find a free slot", "create a meeting"), use the scripts and data below to answer.

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **files-as-database** — Settings and configuration in SQL via `@agent-native/core/settings`. Structured data (bookings) in SQLite via Drizzle ORM + @libsql/client.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE (streams DB change events).
- **frontend-design** — Build distinctive, production-grade UI. Read this skill before creating or restyling any component, page, or layout.

---

## Learnings & Preferences

**Always read `learnings.md` at the start of every conversation.** This file is the app's memory — it contains user preferences, corrections, important context, and patterns learned from past interactions.

**Update `learnings.md` when you learn something important:**

- User corrects your tone, style, or approach
- User shares personal info relevant to the app (contacts, preferences, habits)
- You discover a non-obvious pattern or gotcha
- User gives feedback that should apply to future conversations

Keep entries concise and actionable. Group by category. This file is gitignored so personal data stays local.

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

### Build & Dev Commands

```bash
pnpm dev        # Vite dev server + Nitro plugin (single process)
pnpm build      # Single Vite build (client SPA + Nitro server)
pnpm start      # node .output/server/index.mjs (production)
pnpm typecheck  # TypeScript validation
```

---

## Architecture

This is an agent-native calendar app with Google Calendar integration and a public booking page. Events come from Google Calendar API directly (not synced to local files). Bookings are stored in SQLite via Drizzle ORM + @libsql/client. Settings and availability are stored in SQL via the settings API.

### How it works

1. **Frontend** (React + Vite) reads state via API routes
2. **Server** (Nitro) reads events from Google Calendar API, reads/writes bookings in SQLite, reads/writes settings via settings API
3. **Agent** reads/writes settings via scripts, uses scripts for DB operations — changes propagate to UI via SSE
4. **Google Calendar** queried via pull-based approach (no webhooks)

```
┌─────────────────────┐         ┌─────────────────────┐
│  Frontend           │         │  Agent Chat         │
│  (React + Vite)     │◄───────►│  (AI agent)         │
│                     │   SQL   │                     │
│  - reads/writes     │         │  - reads/writes     │
│    data via API     │         │    data + code      │
│  - sends prompts    │         │  - runs scripts     │
│    via agentChat    │         │    via pnpm script  │
│                     │         │                     │
└────────┬────────────┘         └──────────┬──────────┘
         │                                 │
         │         ┌───────────────┐       │
         └────────►│  Backend      │◄──────┘
                   │  (Nitro)      │
                   │               │
                   │  - API routes │
                   │  - Google Cal │
                   │  - SSE        │
                   └───────┬───────┘
                           │
                   ┌───────┴───────┐
                   │  scripts/     │
                   │               │
                   │  Reusable     │
                   │  Node.js      │
                   │  scripts run  │
                   │  via pnpm     │
                   └───────────────┘
```

## Data Architecture

This app uses SQL for all data: structured data in Drizzle ORM tables, configuration in the settings API.

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

### Events

Calendar events come directly from the Google Calendar API. They are **not** stored locally — the app queries Google Calendar on each request.

### Database Access

Use `getDb()` from `server/db/index.ts` to get a Drizzle database instance. All queries are async. Set `DATABASE_URL` env var for cloud database (Turso); defaults to local `file:data/app.db`.

### Skills

Read the skill files in `.agents/skills/` for detailed patterns:

- **files-as-database** — Settings and config in SQL via settings API
- **delegate-to-agent** — UI never calls LLMs directly
- **scripts** — Complex operations as `pnpm script <name>`
- **sse-file-watcher** — Real-time UI sync via SSE (DB change events)

## Running Scripts

The agent executes backend logic via `pnpm script <name> [--args]`:

```bash
pnpm script sync-google-calendar --from 2026-01-01 --to 2026-06-01
```

The script runner (`scripts/run.ts`) dispatches to individual script files in `scripts/`. Each script exports a default async function that receives CLI args.

### Available Scripts

| Script                 | Args                                                                     | Purpose                                     |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| `sync-google-calendar` | `--from`, `--to`                                                         | Pull Google Calendar events                 |
| `create-event`         | `--title`, `--start`, `--end`, `--description`, `--location`, `--google` | Create event locally + optionally on Google |
| `list-events`          | `--from`, `--to`, `--source`                                             | List events with filtering                  |
| `check-availability`   | `--date`, `--duration`                                                   | Show available time slots for a date        |

Usage: `pnpm script <name> --arg value`

### Adding New Scripts

1. Create `scripts/my-script.ts`:

```typescript
export default async function main(args: string[]) {
  // Parse args, do work, output results
  console.log("Done!");
}
```

2. It's immediately available as `pnpm script my-script --whatever` (auto-discovered by filename, no registration needed).

## Google Calendar OAuth Flow

1. User configures `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Settings (via ApiKeySettings)
2. User clicks "Connect Google Calendar" — redirected to Google consent screen
3. Google redirects back to `/api/google/callback` with auth code
4. Server exchanges code for tokens, saves to the `oauth_tokens` SQL table via `@agent-native/core/oauth-tokens`
5. User can now sync events and create events on Google Calendar

## Agent Chat Integration (UI → Agent)

The app can delegate tasks to the agent chat using `agentChat` from `@agent-native/core`. This lets any UI button or action trigger an agentic flow with full conversational follow-up.

### How It Works

From browser code (React components):

```typescript
import { agentChat } from "@agent-native/core";

// Auto-submit to the agent
agentChat.submit(
  "Find a 30-minute slot next Tuesday for a team meeting",
  "Hidden context: user's timezone is America/Los_Angeles",
);

// Or prefill for user review
agentChat.prefill(
  "Reschedule my 2pm meeting to 3pm tomorrow",
  "Context about the event details...",
);
```

From scripts (Node.js context):

```typescript
import { agentChat } from "@agent-native/core";

agentChat.submit("Google Calendar sync complete — 42 events synced.");
```

### Transport

The `@agent-native/core` chat bridge handles the transport automatically — it works in both browser (postMessage) and Node (stdout) contexts. The harness picks up the messages and routes them to the agent.

### Multi-User Collaboration

For multi-user access, set `DATABASE_URL` to a cloud database provider (Turso, Neon, etc.). The SQL database handles remote access natively — no separate file sync system needed.

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
scripts/         # Agent-callable scripts
data/            # SQLite database file (app.db)
```

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

## Development

```bash
pnpm dev          # Start dev server (client + server)
pnpm build        # Production build
pnpm typecheck    # TypeScript validation
pnpm test         # Run Vitest tests
pnpm script <name> [--args]  # Run a backend script
```

## TypeScript Everywhere

All code in this project must be TypeScript (`.ts`). Never create `.js`, `.cjs`, or `.mjs` files. Node 22+ runs `.ts` files natively, so no compilation step is needed for scripts. Use ESM imports (`import`), not CommonJS (`require`).

## Key Conventions

1. **SQL-backed data model** — events come from Google Calendar API, bookings live in SQLite via Drizzle, settings/config live in SQL via the settings API. SSE pushes DB change events to the UI in real-time.
2. **Scripts for backend logic** — anything the agent needs to execute goes through `pnpm script`. Create reusable scripts for common operations, generate throwaway scripts for one-offs.
3. **Agent chat for complex flows** — use `agentChat.submit()` from scripts and `agentChat.submit()` / `agentChat.prefill()` from the client to delegate multi-step operations, especially when follow-up conversation is valuable.
4. **Keep the UI thin** — the UI should be for direct manipulation. Anything that benefits from AI reasoning or iteration should route through the agent chat.
