---
name: availability-booking
description: >-
  How the booking system works: checking availability, managing booking links,
  configuring availability settings, and the public booking URL pattern.
---

# Availability & Booking

The calendar app includes a booking system where users can share public URLs for others to book time. Availability is configured per-user, and bookings are stored in SQL via Drizzle ORM.

## Availability Settings

Availability is stored in the SQL settings table under the key `calendar-availability`. It defines which days and time windows the user is available.

```json
{
  "timezone": "America/Los_Angeles",
  "schedule": {
    "monday": [{ "start": "09:00", "end": "17:00" }],
    "tuesday": [{ "start": "09:00", "end": "17:00" }],
    "wednesday": [{ "start": "09:00", "end": "12:00" }, { "start": "13:00", "end": "17:00" }],
    "thursday": [{ "start": "09:00", "end": "17:00" }],
    "friday": [{ "start": "09:00", "end": "16:00" }],
    "saturday": [],
    "sunday": []
  }
}
```

Read via: `readSetting("calendar-availability")`
Write via: `writeSetting("calendar-availability", { ... })`

## Checking Availability

The `check-availability` script finds open time slots for a given date by:
1. Reading the availability schedule from settings
2. Fetching events from Google Calendar for that date
3. Computing free slots by subtracting busy intervals from available windows

```bash
# Find 30-minute slots on a date
pnpm action check-availability --date 2026-04-05

# Find 60-minute slots
pnpm action check-availability --date 2026-04-05 --duration 60
```

Required: `--date` (YYYY-MM-DD format).
Optional: `--duration` (minimum slot length in minutes, default 30).

## Booking Links

Booking links are stored in SQL via Drizzle ORM. Each link has a slug, duration, and associated availability.

Booking links can also have required co-hosts. The owner is always included;
`hosts` stores additional required co-hosts:

```bash
pnpm action create-booking-link \
  --title "Steve + Brent" \
  --slug "steve-brent-30" \
  --duration 30 \
  --hosts "brent@example.com"
```

Use `update-booking-link` to add or remove co-hosts on an existing link. Group
booking links only show slots when the owner and every co-host can be checked as
free. When a booking is confirmed, the app creates the Google Calendar event on
the owner's connected account and adds co-hosts as invited attendees.

### Peer working-hours hard filtering

A co-host gets working-hours-aware scheduling only when the owner has also
added that person to their calendar overlay ("subscribed to their calendar")
via `update-overlay-people`, AND that person has reciprocally added the owner
back to their own overlay list. `getEligibleHostAvailability`
(`server/lib/booking-host-availability.ts`) enforces this two-way check before
reading a peer's private `calendar-availability`/`calendar-settings` — overlay
membership is just the owner's own setting, so without the reciprocal check an
owner could add any registered email with no relationship required and have
that stranger's private schedule and time zone read and enriched onto an
anonymous public booking link. For reciprocally-overlaid hosts, the
booking-link slot generator additionally intersects the owner's
`weeklySchedule` with the host's own saved `calendar-availability` schedule
(converted through the host's own time zone) before checking Google free/busy
— so a group link never offers a time outside either person's working hours.
Co-hosts who aren't in a two-way overlay relationship with the owner keep the
original free/busy-only behavior; the UI picks hosts from the overlay list via
a combobox in `BookingHostsEditor` (`app/pages/BookingLinksPage.tsx`), but
still allows a raw email for hosts who should only be checked for conflicts.

The public booking page also exposes each eligible host's resolved IANA time
zone (never their raw schedule) so the booker can reveal a "Show time zones"
grid comparing every host's local time for the same slots, in addition to
their own browser time zone shown by default.

An owner whose overlaid host hasn't reciprocated yet can nudge them: the
"awaiting-reciprocal-overlay" status tooltip in `BookingHostsEditor` offers a
"Send request" action wired to the `request-overlay-reciprocation` action
(`server/lib/overlay-nudge.ts`). It emails the peer asking them to add the
owner back to their own overlay, never mutates the owner's overlay list
itself, and is rate-limited to one email per (owner, peer) pair every 24
hours, and at most 20 emails per owner every 24 hours regardless of peer (an
owner can add unlimited emails to their own overlay list, so a per-peer-only
limit would let them rotate through targets), via a `calendar-overlay-nudges`
setting on the owner, claimed atomically through `mutateUserSetting` so
concurrent requests can't both pass the cooldown check. Expired entries are
pruned on every claim so the log can't grow without bound. It skips sending
(`reason: "already-reciprocal"`) if the peer has already overlaid the owner
back, and releases its cooldown claim without counting it (`reason:
"email-not-configured"`) if no email can actually be delivered — `sent: true`
always means an email really went out. This only reduces friction toward
satisfying the two-way check above — it does not weaken it.

Management sharing is separate from public booking access:

- Use framework sharing actions / the share dialog to grant management access to
  people or the organization.
- The public booking URL and `isActive` decide whether visitors can book.

The UI manages booking links at `/booking-links`. The public booking URL pattern is:

```
/book/{username}/{slug}
```

For example: `/book/steve/30min`

## Bookings

Bookings are the confirmed appointments. They are stored in SQL via Drizzle ORM and visible at `/bookings` in the UI.

## Common Tasks

| User says                              | What to do                                               |
| -------------------------------------- | -------------------------------------------------------- |
| "Am I free Tuesday at 2pm?"            | `check-availability --date 2026-04-08`                   |
| "Find me a 1-hour slot this week"      | Check availability for each day this week with `--duration 60` |
| "Set my hours to 9-5 weekdays"         | Update the `calendar-availability` setting               |
| "Block off Friday afternoons"          | Update the Friday schedule to end at 12:00               |
| "Show my bookings"                     | Navigate to `/bookings`                                  |
| "Show my booking links"                | Navigate to `/booking-links`                             |

## Important Notes

- Availability settings affect what time slots are offered on public booking pages
- Google Calendar events are checked in real time when computing availability
- All-day events block the entire day
- Bookings create events on Google Calendar when connected
