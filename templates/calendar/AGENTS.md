# Calendar — Agent Guide

You are the AI assistant for this calendar app. You can view, create, update, and manage the user's calendar events, bookings, and availability. When a user asks about their schedule (e.g. "what's on my calendar today", "find a free slot", "create a meeting"), use the scripts and data files below to answer.

This is an **agent-native** app built with `@agent-native/core`. See `.agents/skills/` for the framework rules that apply to all agent-native apps:

- **files-as-database** — All state is files. No databases, no localStorage.
- **delegate-to-agent** — UI never calls an LLM directly. All AI goes through the agent chat.
- **scripts** — Complex operations are scripts in `scripts/`, run via `pnpm script <name>`.
- **sse-file-watcher** — UI stays in sync with agent changes via SSE.
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

## Architecture

This is an agent-native calendar app with Google Calendar integration and a public booking page. Everything is files — JSON files in `data/` are the single source of truth.

### How it works

1. **Frontend** (React + Vite) reads state via API routes
2. **Server** (Express) reads/writes JSON files in `data/`
3. **Agent** reads/writes files directly — changes propagate to UI via SSE
4. **Google Calendar** synced via pull-based approach (no webhooks)

```
┌─────────────────────┐         ┌─────────────────────┐
│  Frontend           │         │  Agent Chat         │
│  (React + Vite)     │◄───────►│  (AI agent)         │
│                     │  files  │                     │
│  - reads/writes     │         │  - reads/writes     │
│    files via API    │         │    files + code     │
│  - sends prompts    │         │  - runs scripts     │
│    via agentChat    │         │    via pnpm script  │
│                     │         │                     │
└────────┬────────────┘         └──────────┬──────────┘
         │                                 │
         │         ┌───────────────┐       │
         └────────►│  Backend      │◄──────┘
                   │  (Express)    │
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

## Core Principle: Everything is Files

All stateful data in this app is stored in **files**. The frontend (React/Vite) reads and writes files. The agent chat reads and writes files. Scripts read and write files. Files are the shared state mechanism between all three.

This means:

- When the UI updates something, it writes to files via the backend API (`/api/events`, `/api/bookings`, etc.)
- When the agent needs to do something, it reads/writes the same JSON files directly (in `data/events/`, `data/bookings/`)
- **No localStorage** — JSON files are the only source of truth
- The frontend subscribes to file changes via SSE, so agent edits to JSON files appear in the UI in real-time

### Data Model (files-as-database)

All state lives in JSON files:

| Path                      | Contents                                       |
| ------------------------- | ---------------------------------------------- |
| `data/events/{id}.json`   | Calendar events (local or synced from Google)  |
| `data/bookings/{id}.json` | Incoming bookings from the public booking page |
| `data/availability.json`  | Availability schedule configuration            |
| `data/settings.json`      | App settings (timezone, booking page config)   |
| `data/google-auth.json`   | Google OAuth tokens (gitignored, sensitive)    |
| `data/sync-config.json`   | File sync patterns                             |

### Skills

Read the skill files in `.agents/skills/` for detailed patterns:

- **files-as-database** — All state as JSON files in `data/`
- **delegate-to-agent** — UI never calls LLMs directly
- **scripts** — Complex operations as `pnpm script <name>`
- **sse-file-watcher** — Real-time UI sync via SSE

## Running Scripts

The agent executes backend logic via `pnpm script <name> [--args]`:

```bash
pnpm script sync-google-calendar --from 2026-01-01 --to 2026-06-01
```

The script runner (`scripts/run.ts`) dispatches to individual script files in `scripts/`. Each script exports a default async function that receives CLI args.

### Available Scripts

| Script                 | Args                                                                     | Purpose                                     |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| `sync-google-calendar` | `--from`, `--to`                                                         | Pull Google Calendar events to data/events/ |
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

2. Register in `scripts/run.ts`:

```typescript
const scripts: Record<string, () => Promise<...>> = {
  "my-script": () => import("./my-script.js"),
  // ...existing scripts
};
```

3. The agent can now run it: `pnpm script my-script --whatever`

## Google Calendar OAuth Flow

1. User configures `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Settings (via ApiKeySettings)
2. User clicks "Connect Google Calendar" — redirected to Google consent screen
3. Google redirects back to `/api/google/callback` with auth code
4. Server exchanges code for tokens, saves to `data/google-auth.json`
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

### File Sync (Multi-User Collaboration)

File sync is **opt-in** — enabled when `FILE_SYNC_ENABLED=true` is set in `.env`.

**Environment variables:**

| Variable                         | Required      | Description                                          |
| -------------------------------- | ------------- | ---------------------------------------------------- |
| `FILE_SYNC_ENABLED`              | No            | Set to `"true"` to enable sync                       |
| `FILE_SYNC_BACKEND`              | When enabled  | `"firestore"`, `"supabase"`, or `"convex"`           |
| `SUPABASE_URL`                   | For Supabase  | Project URL                                          |
| `SUPABASE_PUBLISHABLE_KEY`       | For Supabase  | Publishable key (or legacy `SUPABASE_ANON_KEY`)      |
| `GOOGLE_APPLICATION_CREDENTIALS` | For Firestore | Path to service account JSON                         |
| `CONVEX_URL`                     | For Convex    | Deployment URL from `npx convex dev` (must be HTTPS) |

**How sync works:**
- `createFileSync()` factory reads env vars and initializes sync
- Files matching `sync-config.json` patterns are synced to/from the database
- Sync events flow through SSE (`source: "sync"`) alongside file change events
- Conflicts produce `.conflict` sidecar files and notify the agent

**Checking sync status:**
- Read `data/.sync-status.json` for current sync state
- Read `data/.sync-failures.json` for permanently failed sync operations

**Handling conflicts:**
- When `application-state/sync-conflict.json` appears, resolve the conflict
- Read the `.conflict` file alongside the original to understand both versions
- Edit the original file to resolve, then delete the `.conflict` file

**Scratch files (not synced):**
- Prefix temporary files with `_tmp-` to exclude from sync

## Project Structure

```
client/          # React SPA
  components/
    layout/      # AppLayout, Sidebar
    calendar/    # MonthView, WeekView, DayView, EventCard, EventDialog, etc.
    booking/     # DatePicker, TimeSlotPicker, BookingForm, BookingConfirmation
    ui/          # shadcn/ui components
  hooks/         # React Query hooks (use-events, use-bookings, etc.)
  pages/         # Route pages
server/          # Express backend
  routes/        # API route handlers
  lib/           # Google Calendar client, data helpers, env config
shared/          # Shared TypeScript types
scripts/         # Agent-callable scripts
data/            # File-based data storage
```

## Tech Stack

- **Framework**: @agent-native/core
- **Package manager**: pnpm
- **Frontend**: React 18, React Router 6, TypeScript, Vite, TailwindCSS
- **Backend**: Express
- **UI components**: Radix UI + Lucide icons
- **Google Integration**: googleapis npm package
- **State**: File-based JSON in `data/`
- **Path aliases**: `@/*` → client/, `@shared/*` → shared/

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

1. **Files are the only source of truth** — all calendar state lives in JSON files in `data/`. UI edits save to these files via API. Agent edits the files directly. SSE pushes file changes to the UI in real-time.
2. **Scripts for backend logic** — anything the agent needs to execute goes through `pnpm script`. Create reusable scripts for common operations, generate throwaway scripts for one-offs.
3. **Agent chat for complex flows** — use `agentChat.submit()` from scripts and `agentChat.submit()` / `agentChat.prefill()` from the client to delegate multi-step operations, especially when follow-up conversation is valuable.
4. **Keep the UI thin** — the UI should be for direct manipulation. Anything that benefits from AI reasoning or iteration should route through the agent chat.
