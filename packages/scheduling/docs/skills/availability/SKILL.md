---
name: availability
description: How schedules, weekly rules, date overrides, travel schedules, and out-of-office entries combine to determine when someone is bookable.
---

# Availability

## Schedule

A named set of rules (e.g. "Working Hours"). Each user has ≥1 schedule and
marks one as `isDefault`. Event types either use the user's default or
reference a specific schedule.

Timezone is set on the schedule, not the user — lets you have a "Europe
hours" schedule and a "US hours" schedule for the same person.

## Weekly availability

Rows in `schedule_availability`: (day 0-6, startTime "HH:MM", endTime
"HH:MM"). You can have multiple intervals per day — e.g. Mon 9-12 and 1-5.

## Date overrides

Rows in `date_overrides`: (date "YYYY-MM-DD", intervals JSON).
- `intervals: []` → day fully blocked.
- `intervals: [{start, end}]` → only those times available on that date.

## Travel schedules

`travel_schedules` overrides the user's default timezone for a date range.

## Out of office

`out_of_office_entries` blocks bookings across a range, optionally with a
redirect to another team member.

## Common tasks

| User request | Action |
|---|---|
| "I'm unavailable next Friday" | `add-date-override --scheduleId <id> --date 2026-04-10 --intervals []` |
| "I take lunch 12-1 weekdays" | `update-schedule --weeklyAvailability [...9-12, 13-17...]` |
| "Create evenings schedule" | `create-schedule --name Evenings --weeklyAvailability [...]` |
| "Going to Tokyo next week" | Insert a `travel_schedules` row (no dedicated action yet) |
