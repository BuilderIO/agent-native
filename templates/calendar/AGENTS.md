# Calendar — Agent Guide

Calendar is an agent-native scheduling app. The agent manages events,
availability, booking links, connected calendars, visual preferences, and sharing
through actions and SQL-backed application state.

Detailed event, availability, booking, storage, and UI rules live in
`.agents/skills/`.

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
- Use `get-attendee-timezones` / `set-attendee-timezone` to read or save
  per-guest IANA timezone overrides (`attendee-timezones` user setting). The UI
  shows each guest's local event-start time when a timezone is known (self from
  the event/browser zone; others from `attendee.timeZone` or the override map).
- Use `rsvp-event` for invitation responses. Pass `note` when the user wants a
  visible RSVP comment on a declined or tentative response; pass an empty note to
  clear an existing RSVP comment.
- When adding guests to an existing event, prefer `update-event` with
  `addAttendees` so existing RSVP notes/statuses are preserved. Use
  `scope: "all"` only when the user wants a recurring-event guest change applied
  to the whole series.
- Pass `optional: true` on an attendee object to mark someone optional when
  creating, drafting, or adding guests. To change optional/required after the
  fact, replace the full `attendees` list with `optional` set on that guest.

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

## Skills

Read the relevant skill before deeper work:

- `event-management` for create/update/delete event flows.
- `availability-booking` for free/busy, booking links, and scheduling.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.
