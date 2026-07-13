# @agent-native/scheduling

Scheduling primitives for agent-native apps.

Powers the `calendar` template and custom scheduling surfaces. Provides:

- **Drizzle schemas** — event types, schedules, availability rules, bookings, teams, workflows, routing forms
- **Pure helpers** — slot computation (DST-safe), availability rule evaluation, round-robin assignment, recurring event expansion
- **Server layer** — DB repos, availability engine, booking service, pluggable calendar/video providers
- **Actions** — `defineAction` modules consumed as agent tools + HTTP endpoints
- **React primitives** — headless hooks (`useSlots`, `useBookingFlow`, `useTimezone`) + opt-in styled components
- **AI-readable docs** — `llms.txt` bundle and skill files for the agent

## Install

```bash
pnpm add @agent-native/scheduling
```

Peer-depends on `@agent-native/core`, `drizzle-orm`, and (optionally) `react`.

## Compose

Template's `server/db/schema.ts`:

```ts
export * from "@agent-native/scheduling/schema";
```

Template's `actions/create-booking.ts`:

```ts
export { default } from "@agent-native/scheduling/actions/create-booking";
```

Override by replacing the stub body with a full `defineAction(...)`.

## Package lifecycle

Scheduling publishes a static, versioned `agent-native.package.json`. Inspect
its contributions without executing package code, preview installation, or
eject the published source into a local workspace package:

```bash
agent-native package inspect @agent-native/scheduling --json
agent-native package add @agent-native/scheduling --apply
agent-native package eject @agent-native/scheduling --apply
```

Add and eject are dry-run unless `--apply` is explicit. The CLI refuses file
collisions and unsupported layouts and rolls back if dependency installation
fails.

## Docs for your AI

Expose the package docs to your AI coding tool via `llms.txt`:

```
node_modules/@agent-native/scheduling/docs/llms.txt
node_modules/@agent-native/scheduling/docs/llms-full.txt
```

Or fetch over HTTP when deployed:

```
/docs/scheduling.md
/docs/scheduling-full.md
```

## Eject

For full customization, eject the package source into your repo (v0.2). For now,
copy files you want to own into `packages/scheduling-local/` and swap the
dependency manually. See `docs/eject.md`.
