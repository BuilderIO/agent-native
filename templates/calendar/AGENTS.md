# Calendar — Agent Guide

Calendar is an agent-native scheduling app. The agent manages events,
availability, booking links, connected calendars, visual preferences, and sharing
through actions and SQL-backed application state.

## Skills

Detailed event, availability, booking, storage, and UI rules live in
`.agents/skills/`. Read the relevant skill before deeper work:

- `event-management` for create/update/delete event flows, `list-events` result
  formats and source coverage, and working locations.
- `availability-booking` for free/busy, booking links, and scheduling.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.

Before building common workspace or agent UI, read `agent-native-toolkit` to
inventory existing public kits and installed package seams. Use
`customizing-agent-native` for the configure → compose → eject → propose seam
ladder.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Use actions for events, availability, booking links, settings, navigation,
  Google Calendar connection, and sharing. Do not bypass app access checks.
- Use `connect-google-calendar` when the user asks to connect or reconnect
  Google Calendar. Return its link to the user; do not `fetch`
  `/_agent-native/google/auth-url` from the agent backend because that route
  requires the signed-in browser session.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. The action schema is authoritative.
- Use the current date from runtime context, not a visible calendar date, when
  the user says today/tomorrow/yesterday.
- Use `view-screen` when the active date range, selected event, booking link, or
  connected-calendar health is unclear.
- Treat provider-specific actions as shortcuts, not capability limits. When the
  exact Google Calendar, CRM, or enrichment endpoint/filter/pagination/API
  version matters, use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request` against the real provider API instead of weakening the
  answer around a narrow action.
- For relationship-history searches, prefer raw Google Calendar API calls via
  `provider-api-request` so the agent controls `calendarId`, `timeMin`,
  `timeMax`, `q`, `maxResults`, and pagination. For large scans, stage results
  with `stageAs` and analyze them with `query-staged-dataset`.
- For Google Calendar, distinguish an empty calendar from missing auth,
  reauth-needed, or fetch failures.
- `list-events` returns the UI-compatible list by default and the compact
  inventory envelope to MCP callers. Preserve its account coverage,
  `sourceCoverage`, and `coverageComplete` fields — a partial source failure is
  not an empty calendar. See `event-management` for the formats and the
  `accountEmails` rules.
- Treat Google Calendar working locations as native status events, never as
  generic all-day events. See `event-management` for
  `workingLocationProperties`, single-occurrence scope, and the working-hours
  limitation.
- Full-day out-of-office creation uses inclusive human dates plus an IANA
  timezone. `create-event` translates them to local-midnight timed bounds and
  sends provider `allDay: false`; do not expose Google's timed-only constraint
  as a required pair of time inputs in the UI. See `event-management` for the
  action contract and decline behavior.
- Use framework sharing actions for calendars/events/booking resources when
  applicable.
- Booking-link sharing controls who can manage the link. Public booking access
  is still controlled by the `/book/{username}/{slug}` URL and `isActive`.
- `create-booking-link` and `update-booking-link` accept `hosts` for required
  co-hosts besides the owner, e.g. `hosts: ["brent@example.com"]`. Group links
  only offer times when the owner and all co-hosts are free, then invite
  co-hosts to the created Google Calendar event.
- Keep scheduling answers concrete: exact dates, time zones, conflicts, and
  assumptions.
- Event detail (panel and popover) exposes `calendar.event-detail.bottom` as an
  `ExtensionSlot`. Extensions render as widgets there with `slotContext`
  (eventId, title, start/end, timezones, location, attendees, accountEmail).
  For inline adornments next to each guest email (e.g. local times), prefer the
  first-party attendee timezone UI / `set-attendee-timezone` settings, or a
  source edit — do not claim the slot can inject per-row UI.
- Use `rsvp-event` for invitation responses, and `update-event` with
  `addAttendees` (not a replacement `attendees` list) when inviting more people.
  See `event-management` for RSVP notes, optional guests, recurring guest scope,
  and `get-attendee-timezones` / `set-attendee-timezone` overrides.

## Application State

- `navigation` exposes the current view, date, selected event, calendar account,
  booking link, and settings context.
- `navigate` moves the UI to calendar, event, availability, booking, and settings
  views.
- Use actions for full event details and availability calculations.
- Preserve `accountEmail` on every Google event write. When more than one
  Google account is connected, pass the chosen account to `create-event`, and
  pass the event's returned `accountEmail` to `update-event`, `delete-event`,
  and `rsvp-event`. These actions target that account's primary calendar.
