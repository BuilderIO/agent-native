---
name: scheduling-basics
description: Core concepts of the scheduling package — event types, schedules, bookings, hosts, teams, and how they compose.
---

# Scheduling basics

This app is a Cal.com clone. The mental model:

- **Event Type** — a definition of "a bookable thing" (30-minute intro call,
  45-minute demo). Lives at `/:user/:slug` or `/team/:teamSlug/:slug`.
- **Schedule** — a named set of availability rules ("Working Hours",
  "Evenings"). Weekly intervals plus date-specific overrides. Each user
  has a default schedule; event types can pick any.
- **Booking** — the materialized appointment. Has attendees, references to
  external systems (Google Calendar event, Zoom meeting), and a stable
  iCalUID across reschedules.
- **Host** — a user assigned to an event type. Hosts have weights and
  priorities for round-robin.
- **Team** — a group of users who can co-host event types.
- **Location** — where the meeting happens. Video (Cal Video, Zoom, Meet,
  Teams), phone, in-person, or custom link.

## Workflows and routing forms

- **Workflow** — trigger + ordered steps. "Email attendee 1h before event."
- **Routing Form** — pre-booking form with rules that route to the right
  event type based on answers. Like ChiliPiper.

## Public URLs

- `/:user` — user profile with event type list
- `/:user/:slug` — Booker for a personal event type
- `/:user/:slug/embed` — chromeless for iframe embedding
- `/team/:teamSlug` — team profile
- `/team/:teamSlug/:slug` — Booker for team event type (round-robin or collective)
- `/d/:hash/:slug` — private hashed-link Booker
- `/booking/:uid` — booking detail / manage
- `/reschedule/:uid` — reschedule Booker
- `/forms/:formId` — public routing form

## Common tasks

| User request | Action(s) |
|---|---|
| "Create a 30-minute intro meeting" | `create-event-type --title "Intro" --slug intro --length 30` |
| "What's my availability tomorrow?" | `check-availability --slug <slug> --from ... --to ...` |
| "Cancel my 3pm with Alex" | `list-bookings --status upcoming`, then `cancel-booking --uid ...` |
| "Block next Friday" | `add-date-override --scheduleId <id> --date 2026-04-10 --intervals []` |
| "Connect Google Calendar" | `connect-calendar --kind google_calendar --redirectUri ...` |
| "Make a team event rotating between Alice and Bob" | `create-event-type --schedulingType round-robin --teamId ...`, then `set-event-type-hosts` |
