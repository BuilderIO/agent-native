# @agent-native/scheduling

Scheduling primitives for agent-native apps.

Powers the `scheduling` template (Cal.com clone) and the `calendar` template. Provides:

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
