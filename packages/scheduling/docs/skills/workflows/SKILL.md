---
name: workflows
description: Trigger-based automations — reminders, follow-ups, webhooks — across the booking lifecycle.
---

# Workflows

## Triggers

- `new-booking` — fires when a booking is created
- `before-event` — offset minutes BEFORE `startTime`
- `after-event` — offset minutes AFTER `endTime`
- `reschedule` — booking rescheduled
- `cancellation` — booking cancelled
- `no-show` — a host marked an attendee as no-show

## Steps

| Action | Sends |
|---|---|
| `email-host` | Email to the organizer |
| `email-attendee` | Email to the attendee |
| `email-address` | Email to a fixed address (e.g. ops@example.com) |
| `sms-attendee` | SMS to the attendee's phone (requires attendee `phone` custom field) |
| `sms-host` | SMS to the host |
| `sms-number` | SMS to a fixed number |
| `webhook` | HTTP POST to a URL |

Step `offsetMinutes` is relative to the trigger time. For `before-event`
use positive values (we apply them with a minus sign internally).

## Template variables

In email subjects / bodies and SMS bodies:
- `{eventName}` — event type title
- `{attendeeName}`, `{attendeeEmail}` — first attendee
- `{hostName}`, `{hostEmail}` — organizer
- `{startTime}`, `{endTime}` — formatted in host's timezone
- `{location}` — meeting URL or address
- `{cancelUrl}`, `{rescheduleUrl}` — public magic links

## Firing

When a booking fires a trigger, the hook dispatcher materializes rows in
`scheduled_reminders`. A recurring job processes due rows and fires the
actual emails/SMS/webhooks. Framework-side recurring jobs handle the
polling.

## Common tasks

| User | Action |
|---|---|
| "Email attendees 24h before the meeting" | `create-workflow --trigger before-event --steps '[{action: email-attendee, offsetMinutes: 1440}]'` |
| "Text me when someone books" | `create-workflow --trigger new-booking --steps '[{action: sms-host, ...}]'` |
| "Stop all reminders on an event type" | `toggle-workflow` to disable |
