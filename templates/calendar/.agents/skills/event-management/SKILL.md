---
name: event-management
description: >-
  How to create, search, and list calendar events via Google Calendar. Covers
  the list-events, search-events, and create-event scripts, date format
  patterns, and the --google flag.
---

# Event Management

Create, search, and list calendar events. Events come from the Google Calendar API — they are NOT stored in the local SQL database.

## Key Principle

**Events live in Google Calendar, not SQL.** Never use `db-query` or `db-exec` to work with events. Always use the dedicated scripts which query the Google Calendar API directly.

## Scripts

### list-events

Query events from Google Calendar within a date range.

```bash
# Today's events (--to is exclusive, so use tomorrow)
pnpm action list-events --from 2026-04-03 --to 2026-04-04

# This week
pnpm action list-events --from 2026-04-03 --to 2026-04-10

# Filter by title
pnpm action list-events --query "standup" --from 2026-04-01 --to 2026-04-30

# JSON output with full details (attendees, description, conference links)
pnpm action list-events --from 2026-04-03 --to 2026-04-04 --json
```

**Default range:** 7 days ago to 30 days forward. Always provide explicit `--from` and `--to` for predictable results.

**Date format:** Use ISO dates (`YYYY-MM-DD`). Natural language is also supported: `today`, `tomorrow`, `next week`, `monday`, `friday`, etc.

### search-events

Search events by title. Returns JSON with full details including attendees.

```bash
pnpm action search-events --query "Builder"
pnpm action search-events --query "1:1" --from 2026-04-01 --to 2026-04-30
```

Always requires `--query`. Case-insensitive substring match on event title.

### create-event

Create a new event on Google Calendar.

```bash
pnpm action create-event \
  --title "Team standup" \
  --start 2026-04-03T09:00:00 \
  --end 2026-04-03T09:30:00

pnpm action create-event \
  --title "Lunch with Alice" \
  --start 2026-04-03T12:00:00 \
  --end 2026-04-03T13:00:00 \
  --location "Cafe" \
  --description "Discuss Q2 plans"
```

Required: `--title`, `--start`, `--end` (all ISO datetime format).
Optional: `--description`, `--location`.

The event is created directly on Google Calendar. Google Calendar must be connected first.

## Date Patterns

When the user says:

| User says              | What to do                                          |
| ---------------------- | --------------------------------------------------- |
| "today's schedule"     | `list-events --from <today> --to <tomorrow>`        |
| "this week"            | `list-events --from <monday> --to <next-monday>`    |
| "next Tuesday"         | `list-events --from <tuesday> --to <wednesday>`     |
| "meetings with Alice"  | `search-events --query "Alice"`                     |
| "schedule a meeting"   | `create-event --title ... --start ... --end ...`    |
| "what's coming up"     | `list-events` (uses default 30-day forward window)  |

## Google Calendar Connection

Events require a connected Google Calendar account. Check with `GET /_agent-native/google/status`. If not connected, tell the user to connect via the Settings page.

## Event Object Shape

```json
{
  "id": "google-event-id",
  "title": "Team standup",
  "description": "Daily sync",
  "start": "2026-04-03T09:00:00Z",
  "end": "2026-04-03T09:30:00Z",
  "location": "Conference Room A",
  "allDay": false,
  "attendees": [
    { "email": "alice@example.com", "displayName": "Alice", "responseStatus": "accepted" }
  ],
  "conferenceData": { ... },
  "hangoutLink": "https://meet.google.com/...",
  "status": "confirmed",
  "source": "google"
}
```
