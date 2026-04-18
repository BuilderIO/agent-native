# Upgrading the Calendar template

The calendar template is migrating from its own lightweight booking schema
(`bookingLinks` + `bookings`) to the shared `@agent-native/scheduling`
package (Cal.com-style event types, availability schedules, teams, workflows).

## What changed

- New dependency: `@agent-native/scheduling` — provides the schema, server
  repos, availability engine, booking service, calendar/video providers,
  actions, and React hooks.
- The `scheduling` sibling template is the flagship Cal.com clone that
  uses these primitives in full. Calendar stays focused on the Google
  Calendar viewer and lightweight booking; the scheduling template takes
  team / round-robin / routing-forms / workflows.

## Migration path (incremental)

You can continue using the existing `booking_links` / `bookings` tables in
this template with no changes. To adopt the shared package:

### Option 1 — Compose additively (recommended)

Your schema exposes both the legacy tables and the new scheduling tables:

```ts
// server/db/schema.ts
export * from "@agent-native/scheduling/schema"; // event_types, bookings, …
// plus existing tables:
export * from "./legacy-schema.js"; // bookingLinks, bookings(legacy)
```

New features use the scheduling primitives; legacy rows keep working via
the existing actions.

### Option 2 — Full migration (planned for a future release)

Rename legacy tables to match Cal.com terminology:

- `booking_links` → `event_types`
- `booking_link_shares` → `event_type_shares`
- `booking_slug_redirects` → `event_type_slug_redirects`
- `bookings` keeps its name but gains fields (`uid`, `iCalUid`, …).

A Drizzle migration for the rename is planned; until then, apps in
production should stay on Option 1.

## Why

The `scheduling` template is a full Cal.com / Calendly clone with teams,
round-robin, workflows, and routing forms. Both templates share one
source of truth for schedule math, availability rule evaluation, slot
computation, and provider integrations. Every scheduling bugfix lands
once and flows to both apps via the package.
