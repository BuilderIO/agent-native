# Scheduling Template — QA Test Results

**Date:** 2026-04-18
**Port:** 8098
**Test method:** Browser automation via claude-in-chrome + CLI actions

## Summary

| #   | Test                        | Status                  | Notes                                                                                                                                                                                                      |
| --- | --------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | App boots cleanly           | PASS (after fixes)      | Required DB migrations + SSR route + client CSS fix                                                                                                                                                        |
| T2  | Dashboard loads             | PASS                    | All sidebar links return 200                                                                                                                                                                               |
| T3  | Create event type           | PASS                    | Dialog opens, creates Intro call (30m)                                                                                                                                                                     |
| T4  | Event type editor tabs      | PASS                    | Setup / Availability / Limits / Advanced / Apps / Workflows render                                                                                                                                         |
| T5  | Availability schedules      | PARTIAL                 | List + create via CLI works; dialog click glitch in UI (second click needed)                                                                                                                               |
| T6  | Public booker flow          | PARTIAL                 | Date picker + slot list render and load data from DB. AnimatePresence stage transitions have a race with data refetch — slots render but in a mid-animation state (opacity=0) on slow clicks. See bug #B6. |
| T7  | Booking detail + lifecycle  | NOT RUN (blocked by T6) |                                                                                                                                                                                                            |
| T8  | Workflows                   | PASS (list view)        | `/workflows` returns 200                                                                                                                                                                                   |
| T9  | Routing forms               | PASS (list view)        | `/routing-forms` returns 200                                                                                                                                                                               |
| T10 | Settings                    | PASS                    | `/settings/my-account/profile` returns 200                                                                                                                                                                 |
| T11 | Agent context (view-screen) | PASS                    | Returns `{navigation,bookerState,eventTypeDraft,scheduleDraft}`                                                                                                                                            |
| T12 | Empty states                | PASS                    | "No event types yet", "No schedules yet", "No upcoming bookings"                                                                                                                                           |
| T13 | Dark mode                   | PASS                    | Default dark theme applies                                                                                                                                                                                 |
| T14 | Agent actions (CLI)         | PASS                    | list-event-types, create-event-type, check-availability, list-bookings, list-schedules, create-schedule, set-default-schedule all return valid JSON                                                        |

## Bugs found + fixed

### B1: SQLITE_ERROR: no such table: scheduled_reminders (server crash)

- **Root cause:** No DB migrations existed for any of the 37 scheduling tables (`event_types`, `schedules`, `bookings`, `workflows`, `routing_forms`, plus all companion tables and shares tables).
- **Fix:** Created `/Users/steve/Projects/builder/agent-native/framework/templates/scheduling/server/plugins/db.ts` with `runMigrations([...])` for every table in `packages/scheduling/src/schema/*.ts`. 47 migrations total (37 CREATE TABLEs + 10 indexes). All use dialect-agnostic SQL (INTEGER booleans, TEXT timestamps, `(datetime('now'))` default which the framework rewrites to `CURRENT_TIMESTAMP` on Postgres).
- **Re-test:** Server now runs `[db] Applying 47 migration(s) on SQLite/libsql…` and all tables exist.

### B2: Route path collision: `_app._index.tsx` vs `_index.tsx` both mapped to `/`

- **Root cause:** Two routes registered for the `/` path; React Router Vite plugin warned and only used one.
- **Fix:** Deleted `/Users/steve/Projects/builder/agent-native/framework/templates/scheduling/app/routes/_app._index.tsx` (which just redirected to `/event-types`). The intended landing is `_index.tsx` with Scheduling title + Dashboard button.
- **Re-test:** No more route collision warning.

### B3: `NitroViteError: No fetch handler exported from /app/entry.client.tsx` (500 on every route)

- **Root cause:** The scheduling template was missing `server/routes/[...page].get.ts` which is the catch-all SSR handler the calendar template uses. Without it, Nitro auto-detects the React Router client environment's entry (entry.client.tsx) and tries to use that as the SSR handler.
- **Fix:** Created `/Users/steve/Projects/builder/agent-native/framework/templates/scheduling/server/routes/[...page].get.ts` with `createH3SSRHandler(() => import("virtual:react-router/server-build"))`.
- **Re-test:** Every route now returns 200 with the correct rendered HTML.

### B4: CSS import error: `"./global.css" is not exported under the conditions ["style", "development", "import"] from package @agent-native/core`

- **Root cause:** `app/global.css` had `@import "@agent-native/core/global.css"` but core doesn't export that path. No other template imports core's CSS this way; they inline Tailwind directives directly.
- **Fix:** Replaced `app/global.css` with full Tailwind directives + shadcn/ui CSS variables (light + dark), matching the calendar template pattern. Scheduling brand color (violet-600/400) preserved via `--brand-accent`.
- **Re-test:** Page renders with full styling; no PostCSS errors.

### B5: Client-side crash: `Module "events" has been externalized for browser compatibility. Cannot access "events.EventEmitter"`

- **Root cause:** `AppLayout.tsx` and `Booker.tsx` imported `writeAppState` from `@agent-native/core/application-state`, which includes the server-only `emitter.ts` module (uses Node's `EventEmitter`). Bundling it for the browser fails on the `events` module.
- **Fix:** Added browser-safe `writeAppState`, `readAppState`, `deleteAppState` helpers to `app/lib/api.ts` that call the framework's `/_agent-native/application-state/:key` HTTP endpoint directly. Updated both `AppLayout.tsx` and `Booker.tsx` to import from `@/lib/api`.
- **Re-test:** No more EventEmitter error; nav state writes succeed (confirmed via `pnpm action view-screen`).

### B6: Booker AnimatePresence stage transitions glitch (intermittent)

- **Root cause (suspected):** `fetchSlots` was an inline arrow function in `Booker.tsx`, creating a new reference each render. This caused `useSlots` to refetch after every state change, which re-rendered Booker, which caused framer-motion AnimatePresence to interrupt its exit animation and leave the old stage at `opacity: 0` mid-transition.
- **Fix:** Wrapped `fetchSlots` in `useCallback(..., [])` in `Booker.tsx`. This stabilizes the reference so `useSlots.load` is stable.
- **Re-test:** Date picker renders and loads slots. Click-to-advance still occasionally stutters due to AnimatePresence race — may need additional work to fully stabilize.

### B7: `agent-native action` failed with `Cannot find module 'scripts/run.ts'`

- **Root cause:** Template was missing `actions/run.ts`, the entry point the CLI looks for.
- **Fix:** Created `/Users/steve/Projects/builder/agent-native/framework/templates/scheduling/actions/run.ts` that:
  1. Imports `setSchedulingContext` from `@agent-native/scheduling/server`
  2. Imports `getDb, schema` from the local `server/db/index.js`
  3. Calls `setSchedulingContext(...)` before `runScript()` — so actions can use the scheduling package repos without the server plugin bootstrap.
- **Re-test:** `pnpm action list-event-types`, `create-event-type`, `check-availability`, `list-bookings`, `list-schedules`, `create-schedule`, `set-default-schedule`, `view-screen` all return valid JSON.

### B8: Robot icon used for Workflows sidebar nav (rule violation)

- **Root cause:** `AppLayout.tsx` used `IconRobot` from `@tabler/icons-react` for the "Workflows" sidebar item. Framework rule: never use robot icons for AI/agents.
- **Fix:** Replaced `IconRobot` with `IconBolt` (fits the "trigger-based automations" semantic). Updated both the import statement and the NAV array in `AppLayout.tsx`.
- **Re-test:** Grepped the whole scheduling template for `IconRobot|IconSparkle|IconSparkles` — no matches.

## Actions tested via CLI (T14)

```
pnpm action list-event-types                # {eventTypes: [Intro call, Demo]}
pnpm action create-event-type --title Demo --slug demo --length 45   # created
pnpm action check-availability --eventTypeId ... --from ... --to ... # 16 slots
pnpm action list-bookings --status upcoming # {bookings: []}
pnpm action list-schedules                  # {schedules: [Working hours]}
pnpm action create-schedule --name "..."    # created
pnpm action set-default-schedule --id ...   # {ok: true}
pnpm action view-screen                     # {navigation, bookerState, eventTypeDraft, scheduleDraft}
```

## Sidebar routes (HTTP 200 check)

All of these returned 200:

- `/event-types`
- `/bookings/upcoming`
- `/availability`
- `/teams`
- `/routing-forms`
- `/workflows`
- `/apps`
- `/settings/my-account/profile`

## Known gaps / follow-ups

- **B6 follow-up:** Booker AnimatePresence still stutters on the first date click after page load. The `fetchSlots` useCallback helps but there may be a second re-render source (eg. writeAppState in a useEffect that depends on `flow.state`). A proper fix is to pull the `booker-state` effect's dependencies to primitives only (not the whole `flow.state` object) or debounce it.
- The Advanced tab's Switch components render off-screen at `max-w-3xl` — they are at x=960 but the container ends at x=1095. Move switches inside a narrower flex row, or widen the container.
- Test T7 (booking + reschedule chain) was blocked on the animation stutter and not completed. The CLI actions `create-booking`, `reschedule-booking`, `cancel-booking` all exist and should work; they were not exercised against the DB in this pass.

## Files touched

- **Created:** `server/plugins/db.ts` (47 migrations)
- **Created:** `server/routes/[...page].get.ts` (SSR catch-all)
- **Created:** `actions/run.ts` (action dispatcher + scheduling context init)
- **Modified:** `app/global.css` (replaced core import with tailwind + vars)
- **Modified:** `app/lib/api.ts` (added browser-safe appState helpers)
- **Modified:** `app/components/layout/AppLayout.tsx` (appState import + IconBolt)
- **Modified:** `app/components/booker/Booker.tsx` (appState import + useCallback for fetchSlots)
- **Deleted:** `app/routes/_app._index.tsx` (route collision)
