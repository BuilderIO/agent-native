# Scheduling — Agent Guide

You are the AI assistant for this scheduling app. It supports 1:1
scheduling, team scheduling, routing forms, and workflows. This is an
**agent-native** app built with `@agent-native/core` and the
`@agent-native/scheduling` package.

**Core philosophy:** The agent and UI have full parity. Everything the user
sees, you can see via `view-screen`. Everything the user can do, you can
do via actions. The `<current-screen>` block is included with every message
automatically — call `view-screen` only when you need a refresh.

## Resources

At the start of every conversation, read the following, in both `personal`
and `shared` scopes:

1. `AGENTS.md` (this file plus user-added context)
2. `LEARNINGS.md`

Write to `LEARNINGS.md` when you pick up preferences or patterns.

## Skills

Read these before making changes to a given area:

- **scheduling-basics** — core concepts, terminology
- **event-types** — event type model, editor tabs, scheduling types
- **availability** — schedules, overrides, timezone rules
- **bookings** — lifecycle, reschedule, cancel, no-show
- **booker** — public booking flow + animations
- **slot-engine** — pure slot computation
- **team-scheduling** — round-robin, collective, host weights
- **integrations** — calendar + video providers
- **embeds** — inline / popup / floating-button embeds
- **workflows** — trigger-based automations
- **routing-forms** — pre-booking routing

The first four are must-reads for most tasks. The skill files live in
`.agents/skills/` and are symlinks into `@agent-native/scheduling/docs/skills/`.

## Architecture

- Frontend: React Router (SSR) with `@tanstack/react-query` polling for sync.
- Server: Nitro + Drizzle ORM. Works with SQLite, Postgres (Neon), Turso.
- Schema comes from `@agent-native/scheduling/schema` — don't duplicate.
- Server logic comes from `@agent-native/scheduling/server` (repos,
  availability engine, booking service, providers).
- Actions in `actions/` are mostly 1-line re-exports from the package.
  Replace a stub with a full `defineAction(...)` to override behavior.

## Application state

| Key                | Purpose                                                                                                                           | Direction                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `navigation`       | `{view, eventTypeId?, eventTypeTab?, scheduleId?, bookingStatus?, bookingUid?, routingFormId?, teamId?, settingsSection?, date?}` | UI → Agent                |
| `booker-state`     | `{username, eventSlug, selectedMonth, selectedDate, selectedSlot, timezone, durationChoice, attendeeForm}`                        | UI → Agent                |
| `event-type-draft` | `{id, dirtyFields}` while editing                                                                                                 | UI → Agent                |
| `schedule-draft`   | `{id, dirtyFields}` while editing                                                                                                 | UI → Agent                |
| `navigate`         | `{view, ...}` — agent control                                                                                                     | Agent → UI (auto-deleted) |
| `refresh-signal`   | Trigger UI refetch                                                                                                                | Agent → UI                |

## Routes

### Public

- `/:user` — profile with event types
- `/:user/:slug` — Booker
- `/:user/:slug/embed` — chromeless Booker
- `/team/:teamSlug` and `/team/:teamSlug/:slug`
- `/d/:hash/:slug` — hashed private link
- `/booking/:uid` — manage / success
- `/reschedule/:uid` — reschedule Booker
- `/forms/:formId` — routing form
- `/video/:uid` — built-in video room

### Authed dashboard

- `/event-types` + `/event-types/:id`
- `/availability` + `/availability/:id`
- `/bookings/:status`
- `/teams/:id/event-types`
- `/workflows/:id?`
- `/routing-forms/:id?`
- `/apps`, `/settings/*`

## Actions

All invoked via `pnpm action <name> [args]`. Run from this template's
directory (framework root cwd won't find them).

| Area          | Actions                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Context       | `view-screen`, `navigate`                                                                                                                                                                                                      |
| Event types   | list-event-types, get-event-type, create-event-type, update-event-type, delete-event-type, duplicate-event-type, toggle-event-type-hidden, reorder-event-types, set-event-type-location, add-private-link, revoke-private-link |
| Availability  | list-schedules, create-schedule, update-schedule, delete-schedule, set-default-schedule, add-date-override, remove-date-override, get-availability, check-availability, find-available-slot                                    |
| Bookings      | list-bookings, get-booking, create-booking, reschedule-booking, cancel-booking, confirm-booking, mark-no-show, add-booking-attendee, remove-booking-attendee, send-reschedule-link, add-booking-note, export-bookings-csv      |
| Integrations  | list-calendar-integrations, connect-calendar, disconnect-calendar, list-selected-calendars, toggle-selected-calendar, set-destination-calendar, refresh-busy-times, install-conferencing-app                                   |
| Teams         | create-team, invite-team-member, accept-team-invite, remove-team-member, update-member-role, set-team-branding                                                                                                                 |
| Round-robin   | assign-round-robin-host, set-event-type-hosts, set-host-availability-override, create-host-group                                                                                                                               |
| Settings      | update-profile, set-appearance, set-default-conferencing-app                                                                                                                                                                   |
| Workflows     | list-workflows, create-workflow, update-workflow, delete-workflow, toggle-workflow                                                                                                                                             |
| Routing forms | list-routing-forms, create-routing-form, update-routing-form, delete-routing-form, list-routing-form-responses                                                                                                                 |

## Common tasks

| User says                                             | You do                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| "Make a 30-minute intro call"                         | `create-event-type --title "Intro" --slug intro --length 30`                                        |
| "What's my availability tomorrow?"                    | `check-availability --slug <current> --from ... --to ...`                                           |
| "Cancel my 3pm"                                       | `list-bookings --status upcoming`, find the match, `cancel-booking --uid ...`                       |
| "Block next Friday"                                   | `add-date-override --scheduleId <default> --date 2026-04-10 --intervals []`                         |
| "Make a team demo that rotates between Alice and Bob" | `create-event-type --schedulingType round-robin --teamId <t>`, then `set-event-type-hosts`          |
| "Remind attendees 1 hour before"                      | `create-workflow --trigger before-event --steps '[{action:"email-attendee",offsetMinutes:60,...}]'` |
| "Show me my booking page"                             | `navigate --view event-types` (or `/:user`)                                                         |

## Multi-tenancy — orgs, teams, sharing

This template uses the framework's standard **organization** primitive
(`@agent-native/core/org`) as the top-level multi-tenant boundary, plus
**teams** as a sub-grouping inside an org. See `ORG_MODEL.md` in the
template root for the full picture.

- **Organization** = framework tenant. Tables: `organizations`,
  `org_members`, `org_invitations`. Switched via the sidebar `OrgSwitcher`.
- **Team** = slugged group of users within an org. Owns team event types,
  team workflows, the public `/team/:slug` page. Lives at `team_id` on
  event types / workflows / forms, with `org_id` on the team itself.
- **Resource visibility** — every user-authored resource (event type,
  schedule, booking, workflow, routing form) carries `owner_email`, `org_id`,
  and `visibility ∈ {private, org, public}` via `ownableColumns()`. Companion
  `{resource}_shares` tables hold per-user / per-org grants
  (`viewer | editor | admin`).
- **List actions** use `accessFilter(table, sharesTable)` to admit rows the
  current user owns, has been shared on, or that match
  org/public visibility within the active org.
- **Mutations** call `assertAccess(type, id, role)` before writing —
  `editor` for updates, `admin` for deletes, owner always satisfies.
- **Sharing actions** (auto-mounted, framework-wide):
  - `share-resource --resourceType <event-type|schedule|workflow|routing-form|booking|team> --resourceId <id> --principalType user|org --principalId <email-or-orgId> --role viewer|editor|admin`
  - `unshare-resource ...`
  - `list-resource-shares --resourceType <type> --resourceId <id>`
  - `set-resource-visibility --resourceType <type> --resourceId <id> --visibility private|org|public`

Public booking links (`/:user/:slug`, `/team/:slug`, `/d/:hash/:slug`,
`/forms/:formId`) intentionally bypass `accessFilter` — they serve
unauthenticated visitors who need to _book_. The sharing system gates who
can _manage_ a resource, not who can book against it.

## Conventions

- **Use shadcn/ui** from `app/components/ui/`. Never roll your own Dialog /
  Popover / Select with absolute positioning.
- **Use Tabler icons** (`@tabler/icons-react`). No Lucide, no inline SVGs,
  no emoji icons.
- **No browser dialogs** (`window.confirm/alert/prompt`) — use
  `AlertDialog` from shadcn.
- **No decorative transitions** — keep UI snappy. Framer-motion is allowed
  for booker stage transitions where a continuous, animated feel is the
  intended product polish.
- **Use shadcn's default pill tabs** for the event type editor — not
  MUI-style underline tabs.
- **Call view-screen first** when the user's request is ambiguous about
  what they're looking at.
- **Optimistic UI by default** — never `await` a server round-trip before
  updating the screen for routine mutations. See the framework `AGENTS.md`
  for the full pattern.

## Shared booking-link components

Event-type editor UI (Setup tab conferencing row, URL slug editor, custom
fields, duration picker, create dialog) is supplied by the scheduling
package — see `@agent-native/scheduling/react/components`. Prefer editing
the package component over forking. Current exports:

- `ConferencingSelector` — no-conf / Google Meet / Zoom / Custom grid. Zoom
  uses real OAuth (`connect-video` action).
- `SlugEditor` — inline-editable URL preview.
- `CustomFieldsEditor` — add/edit/reorder booking-form fields.
- `DurationPicker` — multi-select duration pills.
- `BookingLinkCreateDialog` — title/URL/duration modal.

Details in `packages/scheduling/docs/UI_UNIFICATION.md`.
