---
name: event-management
description: >-
  How to create, search, list, update, and delete calendar events via Google
  Calendar. Covers the list-events, search-events, create-event,
  manage-event-draft, update-event, and delete-event scripts, date format
  patterns, and recurrence updates.
---

# Event Management

Create, search, list, update, and delete calendar events. Events come from the Google Calendar API — they are NOT stored in the local SQL database.

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

# Invite attendees — Google sends email invitations by default
pnpm action create-event \
  --title "Q2 planning" \
  --start 2026-04-03T14:00:00 \
  --end 2026-04-03T15:00:00 \
  --attendees "alice@example.com,bob@example.com" \
  --addGoogleMeet=true

# Create a real Zoom meeting and attach the link
pnpm action create-event \
  --title "Q2 planning" \
  --start 2026-04-03T14:00:00 \
  --end 2026-04-03T15:00:00 \
  --attendees "alice@example.com,bob@example.com" \
  --addZoom=true
```

Required: `--title`, `--start`, `--end` (all ISO datetime format).
Optional: `--description`, `--location`, `--attendees`, `--addGoogleMeet`, `--addZoom`, `--sendUpdates`, `--accountEmail`.

When multiple Google accounts are connected, choose the destination account's
primary calendar with `--accountEmail`:

```bash
pnpm action create-event \
  --title "Team standup" \
  --start 2026-04-03T09:00:00 \
  --end 2026-04-03T09:30:00 \
  --accountEmail secondary@example.com
```

Creating without `accountEmail` is only unambiguous when one Google account is
connected. The action does not support arbitrary non-primary Google calendar
IDs.

When attendees are invited and no video link/provider is supplied, Calendar
automatically adds a Google Meet link by default. Pass `--addGoogleMeet=false`
only when the user explicitly wants no video conferencing. If the user provides
a Zoom/Meet/Teams link in the location or description, or asks for
`--addZoom=true`, do not add Google Meet too.

Native Google Calendar status events are supported:

```bash
# Out of office
pnpm action create-event \
  --title "OOO" \
  --start 2026-04-03T09:00:00 \
  --end 2026-04-03T17:00:00 \
  --eventType outOfOffice

# Focus time
pnpm action create-event \
  --title "Focus time" \
  --start 2026-04-03T09:00:00 \
  --end 2026-04-03T11:00:00 \
  --eventType focusTime

# Working location
pnpm action create-event \
  --title "Working from home" \
  --start 2026-04-03T09:00:00 \
  --end 2026-04-03T17:00:00 \
  --eventType workingLocation \
  --workingLocationType homeOffice
```

Do not use `eventType` for Tasks or appointment schedules. Google Calendar
Tasks are a separate product/API surface, and appointment schedules should use
booking links or availability workflows instead.

Use `--transparency opaque` for Busy and `--transparency transparent` for Free.
Use `--visibility public` or `--visibility private` when the user asks for
public/private visibility.

Use only one generated video provider per event: `--addGoogleMeet=true` or `--addZoom=true`, not both. Zoom requires the user to connect Zoom in Settings first; check with `pnpm action get-zoom-status` when unsure.

`--attendees` accepts a comma- or space-separated list of email addresses. When attendees are provided, Google sends email invitations automatically (`sendUpdates=all`). Use `--sendUpdates=none` to suppress emails.

To mark a guest optional, pass attendees as a JSON array with `optional: true`:

```bash
pnpm action create-event \
  --title "Q2 planning" \
  --start 2026-04-03T14:00:00 \
  --end 2026-04-03T15:00:00 \
  --attendees '[{"email":"alice@example.com"},{"email":"bob@example.com","optional":true}]'
```

Use `--startTimeZone` / `--endTimeZone` with IANA timezone names when the event should be anchored to a specific timezone, e.g. `--startTimeZone America/Los_Angeles`.

Use `--reminders '[{"method":"popup","minutes":10},{"method":"email","minutes":1440}]'` for multiple alerts. Use `--remindersUseDefault false --reminders '[]'` for no alerts.

Use `--colorId 1..11` for a Google Calendar event color. Use `update-calendar-visual-preferences` for broad app display rules instead of per-event Google color.

Use `--attachments '[{"fileUrl":"https://drive.google.com/...","title":"Agenda"}]'` to attach Drive files, HTTPS file links, or files uploaded through the app's file upload storage. Google Calendar supports up to 25 attachments per event.

The event is created directly on Google Calendar. Google Calendar must be connected first.

### manage-event-draft

Prepare an unsent calendar invite draft for user review. Use this when the user
asks to draft, prepare, or review an invite before sending it, especially from
an external agent flow.

```bash
pnpm action manage-event-draft \
  --action create \
  --title "Q2 planning" \
  --start 2026-04-03T14:00:00 \
  --end 2026-04-03T15:00:00 \
  --attendees "alice@example.com,bob@example.com" \
  --addGoogleMeet=true
```

`manage-event-draft` stores `calendar-draft-{id}` in application state and
returns a "Review invite in Calendar" deep link. Opening the link shows the
draft as a visible placeholder on the calendar with the native event detail
editor open. Nothing is written to Google Calendar, and no guest is notified,
until the user presses Create in the UI.

Use `--action update --id <draft-id>` to revise a draft and `--action delete`
to remove one. Draft fields match `create-event` for title, time, description,
location, attendees, reminders, attachments, color, and video provider.

### update-event

Update an existing Google Calendar event. Use the event `id` from `list-events`,
`search-events`, or `get-event`. Always preserve the event's `accountEmail` on
the update so multi-account calendars use the right connected account.

```bash
pnpm action update-event --id google-event-id --accountEmail secondary@example.com --title "New title"
pnpm action update-event --id google-event-id --start 2026-04-03T10:00:00 --end 2026-04-03T10:30:00

# Replace attendee list (Google sends invites to anyone newly added)
pnpm action update-event \
  --id google-event-id \
  --attendees "alice@example.com,bob@example.com,carol@example.com"

# Prefer addAttendees when inviting more people so existing RSVP metadata is preserved
pnpm action update-event \
  --id google-event-id \
  --addAttendees '[{"email":"dana@example.com","optional":true}]'

# Mark an existing guest optional without resetting RSVPs — fetch via get-event,
# then pass the full attendees list with optional:true on that guest
pnpm action update-event \
  --id google-event-id \
  --attendees '[{"email":"alice@example.com"},{"email":"bob@example.com","optional":true}]'

# Suppress invitation emails
pnpm action update-event --id google-event-id --attendees "alice@example.com" --sendUpdates none

# Add generated video conferencing
pnpm action update-event --id google-event-id --addGoogleMeet=true
pnpm action update-event --id google-event-id --addZoom=true

# Add multiple alerts, a Google event color, and an attachment
pnpm action update-event \
  --id google-event-id \
  --reminders '[{"method":"popup","minutes":10},{"method":"email","minutes":1440}]' \
  --colorId 9 \
  --attachments '[{"fileUrl":"https://drive.google.com/...","title":"Agenda"}]'
```

`--attendees` REPLACES the entire attendee list — to add someone, prefer `addAttendees` so existing RSVP notes/statuses are preserved. To change whether a guest is optional or required after the fact, fetch the current list via `get-event` and pass the full `attendees` array with `optional: true` or omit/false for required. Pass an empty string to clear all attendees.

For "add Zoom to this meeting", fetch or use the visible event id and call `update-event --addZoom=true`. Do not create an extension for Zoom; Zoom is a first-party calendar integration handled by the event actions and the Settings page.

For recurring events, pass a Google Calendar RRULE in `--recurrence`. Example: to make a daily event weekdays only, use:

```bash
pnpm action update-event \
  --id google-event-id \
  --recurrence "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR"
```

### delete-event

Delete an event if the user is the organizer, or remove it from their own calendar with `--removeOnly true` when they are not. For recurring events, use `--scope single`, `--scope all`, or `--scope thisAndFollowing`.

Pass the event's `accountEmail` on deletes, including recurring-series choices
and attendee removals, so the operation uses the account that owns the event.

```bash
pnpm action delete-event --id google-event-id --accountEmail secondary@example.com --scope single
pnpm action delete-event --id google-event-id --scope thisAndFollowing
pnpm action delete-event --id google-event-id --removeOnly true
```

### rsvp-event

Accept, decline, or tentatively accept an invitation with the event's
`accountEmail`. Preserve it for recurring RSVP scope as well:

```bash
pnpm action rsvp-event \
  --id google-event-id \
  --accountEmail secondary@example.com \
  --status accepted
```

## Date Patterns

When the user says:

| User says                                      | What to do                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| "today's schedule"                             | `list-events --from <today> --to <tomorrow>`                                 |
| "this week"                                    | `list-events --from <monday> --to <next-monday>`                             |
| "next Tuesday"                                 | `list-events --from <tuesday> --to <wednesday>`                              |
| "meetings with Alice"                          | `search-events --query "Alice"`                                              |
| "schedule a meeting"                           | `create-event --title ... --start ... --end ...`                             |
| "draft an invite"                              | `manage-event-draft --action create --title ... --start ... --end ...`       |
| "schedule a Zoom meeting"                      | `create-event --title ... --start ... --end ... --addZoom=true`              |
| "move/rename/update a meeting"                 | `update-event --id ...`                                                      |
| "add Zoom to this meeting"                     | `update-event --id ... --addZoom=true`                                       |
| "delete/remove a meeting"                      | `delete-event --id ...`                                                      |
| "remove weekends from a daily recurring event" | `update-event --id ... --recurrence "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR"` |
| "what's coming up"                             | `list-events` (uses default 30-day forward window)                           |

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
    { "email": "alice@example.com", "displayName": "Alice", "responseStatus": "accepted" },
    { "email": "bob@example.com", "displayName": "Bob", "responseStatus": "needsAction", "optional": true }
  ],
  "conferenceData": { ... },
  "hangoutLink": "https://meet.google.com/...",
  "status": "confirmed",
  "source": "google"
}
```
