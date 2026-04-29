---
title: "Calendar"
description: "An agent-powered calendar with Google Calendar sync and Calendly-style booking links. Schedule, find slots, and manage availability through plain English."
---

# Calendar

An agent-powered calendar app. Connect your Google Calendar and the agent can read your schedule, find free slots, create events, and manage Calendly-style booking links — all in plain English. It replaces the Google Calendar + Calendly combo with one app you own.

When you open the app, you'll see your calendar in the middle and the agent in the sidebar. The agent always knows which day, week, or event you're looking at, so you can say "schedule a 30-minute call with Alex on this day" without spelling everything out.

## What you can do with it

- **See your real Google Calendar** in day, week, or month view, with multiple accounts overlayed.
- **Subscribe to ICS feeds** (HR time off, conference schedules, team calendars) — read-only, mixed into the same view.
- **Set weekly availability** with timezone support — the agent uses this when finding free slots.
- **Create public booking links** at `/book/{slug}` for things like "15-minute intro" or "30-minute demo." Configure durations, custom fields, and which conferencing tool to use.
- **Ask the agent anything schedule-related**: "Am I free Thursday afternoon?" "Find a 1-hour slot next week and put 'Planning with Alex' on it." "Pause my demo booking link."
- **Share booking links** with teammates so they can manage them too.

## Getting started

Live demo: [calendar.agent-native.com](https://calendar.agent-native.com).

When you first open the app:

1. Click **Settings**.
2. Click **Connect Google Calendar** and approve.
3. (Optional) Connect more Google accounts if you want personal + work overlayed.
4. Open the main view — your real calendar will load.

To create your first booking link:

1. Click **Booking Links** in the sidebar.
2. Click **New booking link**, set a title and duration.
3. Share the public URL — visitors pick from your available slots.

Or just ask the agent: "Create a 15-minute intro booking link with a name field."

### Useful prompts

- "What is on my calendar today?"
- "Am I free Thursday afternoon for 30 minutes?"
- "Find a 1-hour slot next week and put 'Planning with Alex' on it."
- "Reschedule this event to Friday at 2pm." (when an event is selected)
- "Switch to day view and jump to next Monday."
- "Create a booking link called '15 min intro' at 15 minutes with a note field."
- "Pause my '30 min demo' booking link."
- "Block Friday afternoons on my availability."
- "What meetings do I have about 'launch' this month?"

The agent will query Google Calendar live for any schedule question — it never guesses.

## For developers

The rest of this doc is for anyone forking the Calendar template or extending it.

### Quick start

Create a new workspace with the Calendar template:

```bash
npx @agent-native/core create my-app --template calendar
cd my-app
pnpm install
pnpm dev
```

Open `http://localhost:8082` (the default Calendar dev port).

To connect Google Calendar in dev, open the Settings view, paste a `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from [Google Cloud Console](https://console.cloud.google.com/), and click "Connect Google Calendar". The OAuth redirect URI is `http://localhost:8082/_agent-native/google/callback` in dev. Tokens are stored in the `oauth_tokens` SQL table and refresh automatically.

### Key features (technical)

**Calendar views.** The main view at `/` (route `app/routes/_app._index.tsx`) renders the calendar in day, week, or month mode. Switch views from the toolbar, or ask the agent to switch for you. Events are fetched live from Google Calendar — no local sync step is required to see the latest state.

**Multi-account Google Calendar sync.** Connect as many Google accounts as you like. Each connection appears in Settings, and events from every connected calendar overlay in the main view. Sync is pull-based, so no webhooks or background workers are required. The `sync-google-calendar` action refetches a date range on demand. Supporting actions: `list-events`, `search-events`, `get-event`, `create-event`, `sync-google-calendar`.

**External calendars (ICS subscriptions).** Subscribe to read-only ICS or `webcal://` feeds — useful for HR time off, conference schedules, or shared team calendars. Feeds are added in Settings and stored per user. Relevant actions: `add-external-calendar`, `list-external-calendars`, `remove-external-calendar`, `update-external-calendars`.

**Availability rules.** Availability is a weekly schedule of time windows per day, plus a timezone. It is stored in the settings table under the key `calendar-availability`:

```json
{
  "timezone": "America/Los_Angeles",
  "schedule": {
    "monday": [{ "start": "09:00", "end": "17:00" }],
    "tuesday": [{ "start": "09:00", "end": "17:00" }],
    "wednesday": [
      { "start": "09:00", "end": "12:00" },
      { "start": "13:00", "end": "17:00" }
    ],
    "thursday": [{ "start": "09:00", "end": "17:00" }],
    "friday": [{ "start": "09:00", "end": "16:00" }],
    "saturday": [],
    "sunday": []
  }
}
```

Edit it at `/availability` (`app/routes/_app.availability.tsx`) or via the `update-availability` action. The `check-availability` action reads this schedule, subtracts your existing Google Calendar events, and returns free slots of the requested duration.

**Public booking pages.** Booking links are the Calendly replacement. Create one in the UI at `/booking-links` (`app/routes/_app.booking-links._index.tsx`), configure it in the editor at `/booking-links/{id}`, and share the public URL.

Every link has:

- A URL slug, so the public page lives at `/book/{slug}`.
- A primary duration plus an optional list of alternative durations (for example 15, 30, or 60 minutes).
- Optional custom fields collected at booking time.
- A conferencing option (Google Meet, Zoom, or a custom meeting link).
- An `isActive` toggle to pause bookings without deleting the link.

Visitors land on the public page, pick a date and time from the available slots, fill in name, email, and any custom fields, and receive a confirmation. Bookings are stored in the `bookings` table with a `cancelToken`, which powers the public cancel/reschedule page at `/booking/manage/{token}`.

There is also a per-user public URL at `/meet/{username}/{slug}` for clean personal sharing.

**Sharing booking links with teammates.** Booking links are private by default — only the creator can edit or delete them. To let a teammate manage a link, either change the link's visibility or grant explicit access. The framework ships these actions, auto-mounted for any `booking-link` resource:

- `share-resource` — grant a user or org `viewer`, `editor`, or `admin` access.
- `unshare-resource` — revoke a grant.
- `list-resource-shares` — show current visibility plus all grants.
- `set-resource-visibility` — change the coarse visibility (`private`, `org`, or `public`).

Sharing only controls who can manage the link. The public booking URL always accepts bookings from unauthenticated visitors as long as `isActive` is true.

**Inline event previews in chat.** The `/event` route (`app/routes/event.tsx`) renders a compact, chromeless event card that the agent can embed in chat when you ask about a specific event. Title, time, location, attendees, and a description snippet are shown with a button to jump into the main calendar.

### Working with the agent

The agent sees what you are looking at. The current calendar view, the selected date, and the selected event are included in every message as a `current-screen` block, so you can say "this event" or "this day" and it resolves correctly.

Under the hood the agent calls actions like `list-events`, `check-availability`, `create-event`, `navigate`, and `update-availability`. Because events live in Google Calendar, the agent always queries the API instead of guessing — it will not return empty results without running a script first.

### Data model

Defined in `templates/calendar/server/db/schema.ts`. Only non-event data is stored locally:

- `bookings` — confirmed appointments from public booking pages. Stores name, email, start, end, slug, optional notes, custom field responses, meeting link, a `cancelToken` for the public manage URL, and a `confirmed` or `cancelled` status.
- `booking_links` — the Calendly-style link definitions. Slug, title, description, primary `duration`, optional `durations` list, `customFields`, `conferencing`, `color`, and an `isActive` flag. Uses the framework's `ownableColumns` so the sharing system applies.
- `booking_slug_redirects` — remembers old slugs when a link is renamed so existing public URLs keep working.
- `booking_link_shares` — share grants for booking links.

Availability rules and per-user configuration live in the settings table, keyed by `calendar-availability`. Google OAuth tokens live in the framework `oauth_tokens` table. Ephemeral UI state (current view, date, selected event) lives in `application_state` under the `navigation` key.

### Customizing it

Every part of the app is editable source. Start here:

- `templates/calendar/actions/` — every agent-callable operation. Add a new file with `defineAction` to expose new capability to both the agent and the frontend. Key files: `check-availability.ts`, `create-event.ts`, `list-events.ts`, `create-booking-link.ts`, `update-availability.ts`, `add-external-calendar.ts`, `navigate.ts`, `view-screen.ts`.
- `templates/calendar/app/routes/` — the UI. `_app._index.tsx` is the calendar, `_app.availability.tsx` is the schedule editor, `_app.booking-links._index.tsx` and `_app.booking-links.$id.tsx` manage booking links, `_app.bookings.tsx` lists bookings, `_app.settings.tsx` is Settings, and `book.$slug.tsx` plus `meet.$username.$slug.tsx` are the public booking pages.
- `templates/calendar/server/db/schema.ts` — add columns or tables with Drizzle. Keep the code dialect-agnostic so the template runs on SQLite, Postgres, Turso, D1, and Neon.
- `templates/calendar/AGENTS.md` — agent instructions. Update this when you teach the agent new capabilities or conventions.
- `templates/calendar/.agents/skills/` — detailed patterns the agent follows. Relevant skills: `event-management`, `availability-booking`, `real-time-sync`, `storing-data`, `delegate-to-agent`, `frontend-design`.
- `templates/calendar/shared/api.ts` — the shared TypeScript types (`AvailabilityConfig`, `BookingLink`, `ExternalCalendar`, etc.) used by both the server and the client.

If you add a feature, remember to update all four areas: UI, action, skill or AGENTS.md entry, and any application state the agent needs to see. That is what keeps the agent and the UI in parity.
