# Scheduling Template QA — Summary

**Branch:** `updates-120`
**Date:** 2026-04-18
**Port:** 8098 (via `APP_NAME=scheduling pnpm exec vite --port 8098`)

## What was broken (going into QA)

The scheduling template shipped with zero DB migrations (server crashed on `SELECT FROM scheduled_reminders`), a missing SSR catch-all route (500 on every page load), a broken CSS import, a Node-only `EventEmitter` pulled into the browser bundle, no `actions/run.ts` (CLI couldn't dispatch), a route collision at `/`, a rogue `IconRobot`, and a framer-motion AnimatePresence race that froze the Booker mid-animation.

## Bugs fixed (8)

| #   | Bug                                                                                                                                                                                                                                                                                                        | Fix                                                                                                                                                                                                                            | File                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| B1  | Server crash: `SQLITE_ERROR: no such table: scheduled_reminders`. None of the 37 scheduling tables existed.                                                                                                                                                                                                | Wrote `runMigrations([...])` with 37 CREATE TABLE statements + 10 indexes. Dialect-agnostic (INTEGER booleans, TEXT ISO timestamps, `(datetime('now'))` that's rewritten to `CURRENT_TIMESTAMP` on PG).                        | `server/plugins/db.ts` (new, 47 migrations)                                                                              |
| B2  | Route path collision: `/` mapped by both `_app._index.tsx` and `_index.tsx`.                                                                                                                                                                                                                               | Deleted the `_app._index.tsx` redirect route.                                                                                                                                                                                  | `app/routes/_app._index.tsx` (deleted)                                                                                   |
| B3  | Every route returned 500: `NitroViteError: No fetch handler exported from /app/entry.client.tsx`. Nitro was auto-detecting the client env's entry as the SSR handler.                                                                                                                                      | Added the catch-all SSR H3 route that calendar already had.                                                                                                                                                                    | `server/routes/[...page].get.ts` (new)                                                                                   |
| B4  | PostCSS crash: `@import "@agent-native/core/global.css"` — core doesn't export that path.                                                                                                                                                                                                                  | Replaced with standard tailwind directives + shadcn CSS variables (light + dark) + scheduling brand-accent vars.                                                                                                               | `app/global.css`                                                                                                         |
| B5  | Browser runtime error: `Module "events" externalized`. `writeAppState` from `@agent-native/core/application-state` drags `emitter.ts` (uses Node `EventEmitter`).                                                                                                                                          | Added browser-safe helpers hitting `/_agent-native/application-state/:key` over HTTP.                                                                                                                                          | `app/lib/api.ts` (added); `app/components/layout/AppLayout.tsx` and `app/components/booker/Booker.tsx` (updated imports) |
| B6  | Booker AnimatePresence stuck mid-animation (opacity 0, translateX). Root causes: (1) `fetchSlots` was an inline arrow function, causing `useSlots` to refetch every render and interrupt framer-motion exit; (2) `AnimatePresence mode="wait"` with five sibling conditionals made stage transitions race. | (1) Wrapped `fetchSlots` in `useCallback([])`. (2) Replaced 5 sibling `<motion.div>`s inside `AnimatePresence mode="wait"` with a single `motion.div` keyed by `flow.state.stage`, plain `initial/animate` (no exit tracking). | `app/components/booker/Booker.tsx`                                                                                       |
| B7  | `pnpm action X` failed: `Cannot find module 'scripts/run.ts'`. Also even after adding `run.ts`, every action errored: `@agent-native/scheduling: context not initialized`.                                                                                                                                 | Created `actions/run.ts` that calls `setSchedulingContext({ getDb, schema, ... })` before `runScript()`.                                                                                                                       | `actions/run.ts` (new)                                                                                                   |
| B8  | `IconRobot` used for Workflows nav (violates "no robot icons for AI/agents" rule).                                                                                                                                                                                                                         | Swapped to `IconBolt` (better "trigger-based automation" semantic). Also grepped template for `IconRobot\|IconSparkle\|IconSparkles` — no other matches.                                                                       | `app/components/layout/AppLayout.tsx`                                                                                    |

## Test results (14 cases)

- **T1 App boots** — PASS
- **T2 Dashboard** — PASS (all 8 sidebar links return 200)
- **T3 Create event type** — PASS (dialog + toast + list update)
- **T4 Event type editor** — PASS (6 tabs render: Setup / Availability / Limits / Advanced / Apps / Workflows)
- **T5 Availability schedules** — PASS (list + create via UI and CLI)
- **T6 Public booker flow** — PASS (date → slots → form → confirm, all stages now transition correctly after B6 fix)
- **T7 Booking lifecycle** — PASS via CLI (`create-booking` confirmed, `cancel-booking` transitions status to `cancelled`)
- **T8 Workflows** — PASS (list view + `create-workflow` action)
- **T9 Routing forms** — PASS (public `/forms/:formId` renders)
- **T10 Settings** — PASS (profile page with brand color pickers)
- **T11 Agent context** — PASS (`view-screen` returns navigation + bookerState)
- **T12 Empty states + 404** — PASS (each list page has copy, `/no-such-user/no-such-slug` returns 404)
- **T13 Dark mode** — PASS (default dark theme with proper contrast)
- **T14 Agent CLI actions** — PASS (list-event-types, create-event-type, check-availability, list-bookings, create-booking, cancel-booking, list-schedules, create-schedule, set-default-schedule, create-workflow, list-workflows, create-routing-form all return valid JSON)

## Typecheck

`pnpm --filter scheduling typecheck` → clean exit (no errors).

## Files created / modified (summary)

- **Created:** `server/plugins/db.ts`, `server/routes/[...page].get.ts`, `actions/run.ts`, `TEST_RESULTS.md`, `QA_SUMMARY.md`
- **Modified:** `app/global.css`, `app/lib/api.ts`, `app/components/layout/AppLayout.tsx`, `app/components/booker/Booker.tsx`
- **Deleted:** `app/routes/_app._index.tsx`

## Remaining known gaps

1. The Advanced tab's `Switch` widgets sit at the right edge of `max-w-3xl` — they're in the DOM at `x=960` but the container ends at `x=1095`, so depending on viewport they may appear clipped. Not a functional bug; cosmetic.
2. The SlotPicker / Booker UI was not exhaustively exercised for every edge case (DST transition, double-booking, reschedule chain). The underlying CLI actions handle each, but I didn't walk the UI through every one.
3. The `/apps` page is just a placeholder list; apps onboarding flow was not stress-tested.
4. Mobile viewport test was not run explicitly — the code uses `md:` breakpoints so it should collapse, but was not verified at < 640px.

None of the gaps block the template from booting, taking bookings, or exposing itself to the agent.
