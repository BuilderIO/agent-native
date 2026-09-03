# Schema reference

All tables use dialect-agnostic helpers from `@agent-native/core/db/schema`
and compose with `ownableColumns()` + `createSharesTable()` for framework-
wide sharing.

## event_types

The primary bookable resource. Duration, location options, custom fields,
buffers, limits, period (rolling/range/unlimited), scheduling type
(personal/collective/round-robin/managed), optional team assignment,
hashed-link support.

## event_type_hosts

Join between event types and users for collective / round-robin. Each host
has `isFixed`, `weight`, `priority`, optional per-host `scheduleId` override.

## hashed_links

Private booking links: `/d/:hash/:slug`. Optional `expiresAt` and
`isSingleUse`.

## event_type_slug_redirects

Rename history so old URLs keep working.

## schedules / schedule_availability / date_overrides

Named availability presets. `schedules` is the header (name, timezone,
isDefault). `schedule_availability` rows are one weekly interval per day.
`date_overrides` replaces the weekly rule for a specific date (empty =
fully blocked).

## travel_schedules / out_of_office_entries

Per-user timezone overrides for trips; OOO windows that block bookings and
optionally redirect.

## bookings / booking_attendees / booking_references / booking_seats /

## booking_notes

Bookings are the materialized appointments. Attendees are N per booking.
References are external IDs (Google event id, Zoom meeting id). Seats are
reservation tokens for seated events. Notes are host-only.

## teams / team_members

Teams group users. `team_members.role` ∈ owner|admin|member.

## scheduling_credentials / selected_calendars / destination_calendars

`scheduling_credentials` is a view over OAuth tokens (with display metadata
and `invalid` flag). Selected calendars are read for busy-time. Destination
calendar is where new events get written.

## calendar_cache

Short-TTL cache of busy intervals. Busted on booking write.

## workflows / workflow_steps / scheduled_reminders

Trigger-based automations. `workflows` is the rule; `workflow_steps` are
ordered actions; `scheduled_reminders` are materialized sends waiting to
fire (drained by a recurring job).

## webhooks / webhook_deliveries / api_keys

Developer-facing surface: outgoing webhooks with HMAC-signed payloads, and
API keys for programmatic access.

## routing_forms / routing_form_responses

ChiliPiper-style routing forms. Fields + rules → either an event type,
external URL, or custom message.

## verified_emails / verified_numbers

Verified sender addresses / numbers used by workflows.

## Shares tables

For every ownable resource: `event_type_shares`, `schedule_shares`,
`team_shares`, `workflow_shares`, `routing_form_shares`, `booking_shares`.
Use `share-resource` / `set-resource-visibility` framework actions.
