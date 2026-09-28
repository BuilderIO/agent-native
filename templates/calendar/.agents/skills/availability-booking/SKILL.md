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
    "wednesday": [
      { "start": "09:00", "end": "12:00" },
      { "start": "13:00", "end": "17:00" }
    ],
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
via `add-overlay-person`, AND that person has reciprocally added the owner
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

### Working-hours status and the "send request" flow

`BookingHostsEditor` (`app/pages/BookingLinksPage.tsx`) shows a per-host icon
saying whether that host's real working hours are actually being used for the
link. Four states, backed by `getHostOverlayStatuses`
(`server/lib/booking-host-availability.ts`) through the
`get-host-overlay-status` action:

- reciprocal **and** has a saved schedule + resolvable time zone — applied.
- reciprocal but no saved schedule — not applied, and **no action offered**.
  The peer has already done their part; only they can add their own schedule.
- in the owner's overlay list but not reciprocal — not applied, and the only
  state with a `send-overlay-request` button.
- a manual raw-email host — not applied, and offers "Add to my calendar"
  (`add-overlay-person`) rather than a request, because `send-overlay-request`
  rejects any address outside the owner's overlay list.

`reciprocal` and `hasWorkingHours` are reported as two independent booleans and
must not be collapsed into one "applied" flag: the two failure modes are
indistinguishable in the final availability result but need different copy, and
only one of them is actionable by the owner.

The manual state is derived on the client, not returned by the server.
`getHostOverlayStatuses` only ever returns rows for emails already in the
owner's `calendar-overlay-people`; widening it to report on arbitrary addresses
would make it an oracle for probing whether an address has a Calendar account
and a saved schedule.

**Identity.** Both actions resolve the owner from the booking-link row's
persisted `ownerEmail`, never from the signed-in caller, because links are
shareable with non-owner editors and the working-hours relationship is always
about the _owner's_ calendar. Only a brand-new unsaved draft (no
`bookingLinkId` yet) treats the caller as the presumptive owner. When the
caller is not the resolved owner, both actions additionally scope requested
emails to that link's own persisted host list, so a shared collaborator cannot
enumerate the owner's whole personal overlay list.

**Both actions require `"editor"`, including the read one.** Do not relax
`get-host-overlay-status` to `"viewer"`: `booking-link` is registered without
`allowPublic: false`, so a `visibility: "public"` link — the normal state for a
bookable link — resolves to `viewer` for any signed-in caller. At that bar the
action would hand a stranger the owner's co-hosts' display names, time zones,
and request history, which is exactly what `withHostTimezones` strips from the
public booking response.

**Send guardrails**, all enforced in `send-overlay-request`:

- The peer must already be in the owner's `calendar-overlay-people`. Never an
  arbitrary address.
- One request per peer per hour. Inside the cooldown the action is idempotent —
  it returns the existing timestamp and sends nothing, so a double-click or a
  second tab cannot send twice.
- 20 requests per owner per day, counted across all peers. The per-peer
  cooldown alone would still let someone add many peers and send each exactly
  one request; this cap is what bounds the total. It is keyed to the owner, so
  a shared editor spends the owner's quota.
- When email is not configured the action returns
  `{ requestSentAt: null, emailSent: false, skippedReason:
"email-not-configured" }` and records nothing. Do not coerce this to a
  success — the UI shows a distinct message for it.

Timestamps live in the owner's `calendar-overlay-requests` user setting as
`{ [peerEmailLower]: isoTimestamp }`. Entries older than a day are pruned on
write, since they can no longer affect either the cooldown or the cap.
`get-host-overlay-status` reads them back so the button can say "Resend".

The request email deep-links the peer to
`navigate`'s `addPersonEmail` param, which opens the add-a-peer dialog
prefilled with the _requester's_ address. It prefills the search only and never
auto-adds: opening an email must not write someone into the recipient's
calendar.

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

| User says                         | What to do                                                     |
| --------------------------------- | -------------------------------------------------------------- |
| "Am I free Tuesday at 2pm?"       | `check-availability --date 2026-04-08`                         |
| "Find me a 1-hour slot this week" | Check availability for each day this week with `--duration 60` |
| "Set my hours to 9-5 weekdays"    | Update the `calendar-availability` setting                     |
| "Block off Friday afternoons"     | Update the Friday schedule to end at 12:00                     |
| "Show my bookings"                | Navigate to `/bookings`                                        |
| "Show my booking links"           | Navigate to `/booking-links`                                   |

## Important Notes

- Availability settings affect what time slots are offered on public booking pages
- Google Calendar events are checked in real time when computing availability
- All-day events block the entire day
- Bookings create events on Google Calendar when connected
