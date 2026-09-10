# Actions

Every action is a `defineAction` module you can re-export into your
template's `actions/` folder:

```ts
// actions/create-booking.ts
export { default } from "@agent-native/scheduling/actions/create-booking";
```

The action scaffolder can do this for you. Full list:

## Event types

- list-event-types, get-event-type, create-event-type, update-event-type,
  delete-event-type, duplicate-event-type, toggle-event-type-hidden,
  reorder-event-types, set-event-type-location, add-private-link,
  revoke-private-link

## Availability

- list-schedules, create-schedule, update-schedule, delete-schedule,
  set-default-schedule, add-date-override, remove-date-override,
  get-availability, check-availability, find-available-slot

## Bookings

- list-bookings, get-booking, create-booking, reschedule-booking,
  cancel-booking, confirm-booking, mark-no-show, add-booking-attendee,
  remove-booking-attendee, send-reschedule-link, add-booking-note,
  export-bookings-csv

## Integrations

- list-calendar-integrations, connect-calendar, disconnect-calendar,
  list-selected-calendars, toggle-selected-calendar, set-destination-calendar,
  refresh-busy-times, install-conferencing-app

## Team

- create-team, invite-team-member, accept-team-invite, remove-team-member,
  update-member-role, set-team-branding

## Round-robin & hosts

- assign-round-robin-host, set-event-type-hosts,
  set-host-availability-override, create-host-group

## Settings

- update-profile, set-appearance, set-default-conferencing-app

## Workflows

- list-workflows, create-workflow, update-workflow, delete-workflow,
  toggle-workflow

## Routing forms

- list-routing-forms, create-routing-form, update-routing-form,
  delete-routing-form, list-routing-form-responses

All actions respect the framework sharing system — if a resource is not
owned by or shared with the current user, read/write actions throw.
