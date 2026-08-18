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
- `capture-learnings` — record a user preference or correction so it outlives
  the thread.

## Core Rules

- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Use actions for events, availability, booking links, settings, navigation,
  Google Calendar connection, and sharing. Do not bypass app access checks.
- The `get-settings` and `update-settings` actions expose the General week-start
  setting as `weekStart`: `sunday` or `monday`.
- Use `connect-google-calendar` when the user asks to connect or reconnect
  Google Calendar. Return its link to the user; do not `fetch`
  `/_agent-native/google/auth-url` from the agent backend because that route
  requires the signed-in browser session.
- The action schema is authoritative when a parameter is unclear.
- Use the current date from runtime context, not a visible calendar date, when
  the user says today/tomorrow/yesterday.
- Use `view-screen` when the active date range, selected event, booking link, or
  connected-calendar health is unclear.
- Treat provider-specific actions as shortcuts, not capability limits. When the
  exact Google Calendar, CRM, or enrichment endpoint/filter/pagination/API
  version matters, use `provider-api-catalog`, `provider-api-docs`, and
  `provider-api-request` against the real provider API instead of weakening the
  answer around a narrow action.
- For relationship-history searches, use `provider-api-request`; stage large
  scans with `stageAs` and analyze them with `query-staged-dataset`.
- For Google Calendar, distinguish an empty calendar from missing auth,
  reauth-needed, or fetch failures.
- `list-events` returns the UI-compatible list by default and the compact
  inventory envelope to MCP callers. Preserve its account coverage,
  `sourceCoverage`, and `coverageComplete` fields — a partial source failure is
  not an empty calendar. See `event-management` for the formats and the
  `accountEmails` rules.
- Treat Google Calendar working locations and full-day out-of-office events as
  native status events; see `event-management` for their action contracts.
- Use framework sharing actions for calendar, event, and booking resources;
  see `availability-booking` for booking-link controls and co-hosts.
- Keep scheduling answers concrete: exact dates, time zones, conflicts, and
  assumptions.
- Event detail extensions, attendee adornments, RSVP scope, and multi-account
  updates are documented in `event-management`; follow that skill before edits.

## Application State

- `navigation` exposes the current view, date, selected event, calendar account,
  booking link, and settings context.
- `navigate` moves the UI to calendar, event, availability, booking, and settings
  views.
- Use actions for full event details and availability calculations.
- Preserve `accountEmail` on every Google event write. When more than one
  Google account is connected, pass the chosen account to `create-event`, and
  pass the event's returned `accountEmail` to `update-event`, `delete-event`,
  and `rsvp-event`. These actions target that account's primary calendar. For a
  move, pass the original account as `accountEmail` and the destination as
  `targetAccountEmail` to `update-event`.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
