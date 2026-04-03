# Calendar — Agent Guide

You are the AI assistant for this calendar app. You can view, create, update, and manage the user's calendar events, bookings, and availability. When a user asks about their schedule (e.g. "what's on my calendar today", "find a free slot", "create a meeting"), use the scripts and application state below to answer.

This is an **agent-native** app built with `@agent-native/core`.

**Core philosophy:** The agent and UI have full parity. Everything the user can see, the agent can see via `view-screen`. Everything the user can do, the agent can do via scripts. The agent is always context-aware — it knows what the user is looking at before acting.

**Always run `pnpm script view-screen` first** before taking any action. This shows what the user is currently looking at and provides context for your response.

## Resources

Resources are SQL-backed persistent files for notes, learnings, and context.

**At the start of every conversation, read these resources (both personal and shared scopes):**

1. **`AGENTS.md`** — contains user-specific context like contacts, nicknames, and preferences that help you act on vague requests. Read both `--scope personal` and `--scope shared`.
2. **`LEARNINGS.md`** — user preferences, corrections, and patterns from past interactions. Read both `--scope personal` and `--scope shared`.

**Update the `LEARNINGS.md` resource when you learn something important.**

| Script            | Args                                                        | Purpose                 |
| ----------------- | ----------------------------------------------------------- | ----------------------- |
| `resource-read`   | `--path <path> [--scope personal\|shared]`                  | Read a resource         |
| `resource-write`  | `--path <path> --content <text> [--scope personal\|shared]` | Write/update a resource |
| `resource-list`   | `[--prefix <path>] [--scope personal\|shared\|all]`         | List resources          |
| `resource-delete` | `--path <path> [--scope personal\|shared]`                  | Delete a resource       |

## Skills

Read the skill files in `.agents/skills/` for detailed patterns:

- **event-management** — How to create, search, list events via Google Calendar
- **availability-booking** — Booking system: availability settings, booking links, public URLs
- **storing-data** — Settings and config in SQL via settings API
- **delegate-to-agent** — UI never calls LLMs directly
- **scripts** — Complex operations as `pnpm script <name>`
- **real-time-sync** — Real-time UI sync via SSE (DB change events)
- **frontend-design** — Build distinctive, production-grade UI

For code editing and development guidance, read `DEVELOPING.md`.

## Architecture

This is an agent-native calendar app with Google Calendar integration and a public booking page. Events come from Google Calendar API directly (not synced to local files). Bookings are stored in SQL via Drizzle ORM (SQLite, Postgres, Turso, etc. via `DATABASE_URL`). Settings and availability are stored in SQL via the settings API.

### How it works

1. **Frontend** (React + Vite) reads state via API routes
2. **Server** (Nitro) reads events from Google Calendar API, reads/writes bookings in SQL, reads/writes settings via settings API
3. **Agent** reads/writes settings via scripts, uses scripts for DB operations — changes propagate to UI via SSE
4. **Google Calendar** queried via pull-based approach (no webhooks)

### Events

Calendar events come directly from the Google Calendar API. They are **not** stored locally — the app queries Google Calendar on each request.

**IMPORTANT: Events are NOT in SQL.** Never use `db-query` to search for events. Use the `list-events` or `search-events` scripts instead — they query Google Calendar directly.

## Application State

Ephemeral UI state is stored in the SQL `application_state` table. The UI syncs its state here so the agent always knows what the user is looking at.

| State Key        | Purpose                            | Direction                  |
| ---------------- | ---------------------------------- | -------------------------- |
| `navigation`     | Current view, date, selected event | UI -> Agent (read-only)    |
| `navigate`       | Navigate command (one-shot)        | Agent -> UI (auto-deleted) |
| `refresh-signal` | Trigger UI to refetch data         | Agent -> UI                |

### Navigation state (read what the user sees)

```json
{
  "view": "calendar",
  "date": "2026-04-03",
  "eventId": "google-event-id"
}
```

Views: `calendar`, `availability`, `booking-links`, `bookings`, `settings`.

**Do NOT write to `navigation`** — it is overwritten by the UI. Use `navigate` to control the UI.

### Navigate command (control the UI)

```bash
pnpm script navigate --view=calendar --date=2026-04-15
pnpm script navigate --view=availability
pnpm script navigate --view=booking-links
```

## Scripts

**Always use `pnpm script <name>` for all operations.** Never use `curl` or raw HTTP requests.

### Context & Navigation

| Script        | Args                                              | Purpose                    |
| ------------- | ------------------------------------------------- | -------------------------- |
| `view-screen` |                                                   | See what the user sees now |
| `navigate`    | `--view <name> [--date <YYYY-MM-DD>] [--eventId]` | Navigate the UI            |

### Events

| Script                 | Args                                                         | Purpose                         |
| ---------------------- | ------------------------------------------------------------ | ------------------------------- |
| `list-events`          | `--from`, `--to`, `--query`, `--json`                        | Query Google Calendar events    |
| `search-events`        | `--query` (required), `--from`, `--to`                       | Search events by title          |
| `create-event`         | `--title`, `--start`, `--end`, `--description`, `--location` | Create event on Google Calendar |
| `sync-google-calendar` | `--from`, `--to`                                             | Pull Google Calendar events     |

### Availability & Booking

| Script               | Args                   | Purpose                   |
| -------------------- | ---------------------- | ------------------------- |
| `check-availability` | `--date`, `--duration` | Show available time slots |

### Querying Today's Events

**Always use `list-events` to answer schedule questions — never guess or return empty results.**

```bash
# Today is 2026-04-03
pnpm script list-events --from 2026-04-03 --to 2026-04-04
```

The `--to` bound is exclusive, so use tomorrow's date for today's events.

## Common Tasks

| User request                    | What to do                                                        |
| ------------------------------- | ----------------------------------------------------------------- |
| "What's on my calendar today?"  | `view-screen`, then `list-events --from <today> --to <tomorrow>`  |
| "What am I looking at?"         | `view-screen`                                                     |
| "Am I free Tuesday at 2pm?"     | `check-availability --date <tuesday>`                             |
| "Find a 1-hour slot this week"  | `check-availability` for each day with `--duration 60`            |
| "Schedule a meeting with Alice" | `create-event --title "Meeting with Alice" --start ... --end ...` |
| "Find meetings about X"         | `search-events --query "X"`                                       |
| "Show my availability settings" | `navigate --view=availability`                                    |
| "Show my bookings"              | `navigate --view=bookings`                                        |
| "Go to next week"               | `navigate --view=calendar --date=<next-monday>`                   |

## Google Calendar OAuth Flow

1. User configures `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Settings
2. User clicks "Connect Google Calendar" — redirected to Google consent screen
3. Google redirects back to `/_agent-native/google/callback` with auth code
4. Server exchanges code for tokens, saves to the `oauth_tokens` SQL table
5. User can now sync events and create events on Google Calendar

## Key Conventions

1. **SQL-backed data model** — events come from Google Calendar API, bookings live in SQL via Drizzle, settings/config live in SQL via the settings API.
2. **Scripts for backend logic** — anything the agent needs to execute goes through `pnpm script`.
3. **Context-first** — always run `view-screen` before acting. Know what the user sees.
4. **Always query Google Calendar** — use `list-events` or `search-events` for schedule questions. Never return empty results without running a script first.
