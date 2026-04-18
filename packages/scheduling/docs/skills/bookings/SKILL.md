---
name: bookings
description: Booking lifecycle — pending, confirmed, rescheduled, cancelled — plus attendees, references, no-shows, and reminders.
---

# Bookings

## Lifecycle

- **pending** — requires-confirmation event types start here
- **confirmed** — normal state
- **rescheduled** — the old booking after a reschedule (the new one is
  confirmed; `from_reschedule` links them)
- **cancelled** — either party cancelled
- **rejected** — pending was declined

## Reschedule vs cancel+rebook

The `reschedule-booking` action creates a new booking with a link back to
the old via `fromReschedule`. iCalUID is preserved across the reschedule
chain (RFC 5545), and `iCalSequence` is bumped.

## No-show

`mark-no-show` sets `noShow: true` on an attendee. Round-robin calibration
uses this to penalize hosts whose attendees no-show frequently.

## Cancel / reschedule tokens

Every booking has a `cancelToken` and `rescheduleToken` used in public
magic links sent to attendees. These let them manage the booking without
logging in.

## References

External system IDs: Google Calendar event id, Zoom meeting id, Cal Video
room name. Stored in `booking_references`, used during cancel/reschedule to
propagate changes back to the source system.

## ICS

`/booking/:uid.ics` returns the RFC 5545 calendar file. Used for
confirmation-email attachments and "Add to calendar" buttons.
