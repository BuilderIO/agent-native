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
