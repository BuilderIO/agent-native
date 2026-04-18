---
name: event-types
description: How event types work — fields, scheduling types, tabs in the editor, and the full set of configurable options.
---

# Event types

## Editor tabs
- **Setup** — title, slug, duration(s), description, default location
- **Availability** — pick a schedule or override per-event-type
- **Limits** — buffers, min notice, booking window (rolling/range), caps
  (perDay/perWeek/perMonth/perYear), slot interval
- **Advanced** — event name template, lock timezone, require confirmation,
  disable guests, redirect URL, private hashed links, seats
- **Apps** — connect per-event location types (Zoom, Meet, etc.)
- **Workflows** — attach workflows to run on booking lifecycle events

## Scheduling types

| Type | Meaning |
|---|---|
| `personal` | Owned by a user, only they host |
| `collective` | Team event; all selected hosts must be free |
| `round-robin` | Team event; assign to one host by rotation |
| `managed` | Parent event pushed to child event types across members |

## Location kinds

`cal-video`, `zoom`, `google-meet`, `teams`, `phone`, `in-person`,
`custom-link`, `attendee-phone`, `organizer-phone`, `attendee-choice`.

## Custom fields

Text, textarea, number, email, phone, select, multiselect, boolean, radio.
Stored on the event type; responses stored on the booking.

## Hashed links

Private booking URLs at `/d/:hash/:slug`. Create via `add-private-link`,
optionally with `expiresAt` and `isSingleUse`.
