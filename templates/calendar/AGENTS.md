# Calendar — Agent Guide

Calendar is an agent-native scheduling app. The agent manages events,
availability, booking links, connected calendars, visual preferences, and sharing
through actions and SQL-backed application state.

Detailed event, availability, booking, storage, and UI rules live in
`.agents/skills/`.

## Core Rules

- Use actions for events, availability, booking links, settings, navigation,
  Google Calendar connection, and sharing. Do not bypass app access checks.
- In dev, call actions with `pnpm action <name>`; in production, use native
  tools. The action schema is authoritative.
- Use the current date from runtime context, not a visible calendar date, when
  the user says today/tomorrow/yesterday.
- Use `view-screen` when the active date range, selected event, booking link, or
  connected-calendar health is unclear.
- For Google Calendar, distinguish an empty calendar from missing auth,
  reauth-needed, or fetch failures.
- Use framework sharing actions for calendars/events/booking resources when
  applicable.
- Keep scheduling answers concrete: exact dates, time zones, conflicts, and
  assumptions.
- Use `rsvp-event` for invitation responses. Pass `note` when the user wants a
  visible RSVP comment on a declined or tentative response; pass an empty note to
  clear an existing RSVP comment.

## Application State

- `navigation` exposes the current view, date, selected event, calendar account,
  booking link, and settings context.
- `navigate` moves the UI to calendar, event, availability, booking, and settings
  views.
- Use actions for full event details and availability calculations.

## Skills

Read the relevant skill before deeper work:

- `event-management` for create/update/delete event flows.
- `availability-booking` for free/busy, booking links, and scheduling.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.
