# Calendar — Agent Guide

Calendar manages events, availability, booking links, connected calendars, preferences, and sharing through actions and SQL-backed application state.

## Skills

Search skills with `rg --hidden --follow`; read the exact linked guide before deeper work. App: `.agents/skills/event-management/SKILL.md` (event lifecycle, results, working locations), `.agents/skills/availability-booking/SKILL.md` (free/busy, booking links, scheduling). Shared: `.agents/skills/actions/SKILL.md`, `.agents/skills/adding-a-feature/SKILL.md`, `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`, `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`, `.agents/skills/external-agents/SKILL.md`, `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/portability/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/self-modifying-code/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/sharing/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/turn-into-skill/SKILL.md`, and `.agents/skills/workspace-conventions/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"` and `pnpm action docs-search --slug "<slug>"`. Source examples: `pnpm action source-search --query "<pattern>"` or `pnpm action source-search --path <path>`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Use actions for events, availability, booking links, settings, navigation, Google Calendar, and sharing. For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Do not bypass app access checks.
- Use `connect-google-calendar` to connect/reconnect and return its link. Never fetch `/_agent-native/google/auth-url` from the agent backend; it requires the signed-in browser session.
- `get-settings` / `update-settings` store Calendar's own `timezone`, `weekStart`, `defaultEventDuration`, and fallback booking copy. Settings tabs are `calendars` (Google Calendar/Zoom), `booking`, and `rules`. Owner-private invitation prompts live in `eventRules.accept`, `.decline`, and `.hide`; `get-event-rules-status` reports whether a durable recurring sweep runs.
- `update-calendar-visual-preferences` stores view-only preferences, including `allDayMaxHeight` (48–320 px, default 88) for the draggable all-day section in the week-style calendar.
- For multi-event requests use one batch action (`delete-events` or `update-events`); preview destructive batches with `dryRun`. Singular actions are for one event. Use runtime date context for today/tomorrow/yesterday.
- Preserve `accountEmail` on every Google event write. For multiple accounts, pass the chosen account to `create-event`, then the returned `accountEmail` to `update-event`, `delete-event`, and `rsvp-event`. For a move, pass the original `accountEmail` and destination `targetAccountEmail`.
- `list-events` preserves account/source coverage and `coverageComplete`; partial failure is not an empty calendar. Use `list-google-calendars` for available calendars and pass opaque `sourceKey`s to `list-events`. Shared calendars are view-only and do not affect booking availability.
- Distinguish an empty calendar from missing auth, reauth, or fetch failure. Treat working locations and full-day out-of-office as native status events. Use provider API actions for exact endpoints/filters or relationship history; stage large scans with `stageAs` and analyze via `query-staged-dataset`.
- Use framework sharing actions. Keep scheduling answers concrete: dates, time zones, conflicts, and assumptions. See `event-management` for extensions, attendee adornments, RSVP scope, and multi-account details; `availability-booking` for booking controls and peer working-hours/time-zone hard filters.

## Application state

- `navigation` exposes view, date, selected event, calendar account, booking link, and settings. `navigate` opens calendar, event, availability, booking, or settings; use actions for full event details and availability calculations.

## Source changes

Before common workspace/agent UI, read `agent-native-toolkit`; before adapting shared UI, read `customizing-agent-native`.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.
