---
name: team-scheduling
description: Team event types, round-robin assignment, collective bookings, host weights, and no-show calibration.
---

# Team scheduling

## Scheduling types

- **Collective** — all selected team members must be free; booking lists
  all as organizers.
- **Round-robin** — one team member is chosen per booking by a rotation
  strategy.
- **Managed** — parent event type pushed to member-level children (advanced;
  stub in v1).

## Round-robin strategies

| Strategy | How |
|---|---|
| `lowest-recent-bookings` | (Default) host with fewest bookings in past 30d wins; tiebreak by priority, then weight, then email |
| `weighted` | Weighted random pick; deterministic given the same seed |
| `calibrated` | Weighted with no-show penalty (hosts with high no-show rates get fewer) |

## Hosts

Rows in `event_type_hosts`: `{userEmail, isFixed, weight, priority,
scheduleId?}`. Fixed hosts always attend (like collective within a
round-robin set). Weight scales the relative share. Priority (lower =
higher) breaks ties.

## Host schedule override

Normally each host's default schedule is used for their slots. A
per-event-type-per-host override is possible via
`set-host-availability-override`.

## Out-of-office

OOO hosts are auto-excluded from round-robin for the duration of the OOO
window. Bookings can redirect to the OOO's `redirectUserEmail`.

## Host groups

`event_type_host_groups` lets you split hosts into groups — useful for
"collective within each group, round-robin across groups".

## Common tasks

| User | Action |
|---|---|
| "Make a sales demo that rotates Alice / Bob / Carol" | `create-event-type --schedulingType round-robin --teamId ...`, then `set-event-type-hosts` |
| "Add Dave as a fixed host" | `set-event-type-hosts` with Dave as `isFixed: true` |
| "Stop routing to Alice while she's on PTO" | Insert an `out_of_office_entries` row for Alice's range |
