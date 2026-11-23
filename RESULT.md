# Result: Core `navigate` keeps current view and returns a typed success result

## Root Cause (with `file:line`)

1. **Why standalone `navigate` was misclassified as "a write action":**
   - In Labs `templates/calendar-2/actions/navigate.ts:290-383`, after `manage-event update`, `agentEditHoldsEventView` strips `date` and `calendarViewMode` and calls `listCalendarPayload(...)` to check whether `eventId` is already visible in the current Week range.
   - Inside `templates/calendar-2/server/calendar-store.ts:454,464,533`, `listCalendarPayload` updates local cache/catalog tables (`rememberProviderCalendars`, `rememberListedCalendars`, `saveRangeSnapshot`), which triggered `noteSqlStatement` (`packages/core/src/db/note-sql-statement.ts:9`) -> `noteObservedWrite("db")` -> `frame.writeObserved = true` on `navigate`'s own `ActionExecutionFrame`.
   - When `calendar-2/actions/navigate.ts:438` then called `writeAppStateForCurrentTab("navigate", { eventId })`, `packages/core/src/application-state/store.ts:161` invoked `assertNavigateWriteAllowed` (`packages/core/src/application-state/navigate-write-guard.ts:133-171`).
   - `navigate-write-guard.ts:153-161` checked `hasObservedWriteInActionChain()` (and `action-frame.ts:246` excluded any frame with `hasObservedWriteInActionChain()` from `isStandaloneNavigateAction()`) **before** checking `isDefaultDetailNavigation()`, so it threw:
     `AgentNavigationRefusedError: Refused: a write action cannot move the user's view unless intent: "open" is set. Keep the user on their current view, or use navigateAfterWrite() so agent writes stay put.`
2. **Why `navigate` threw an `Error` instead of returning a typed kept-view result:**
   - Even without the cache SQL write, `{ eventId }` matches `isDefaultDetailNavigation` (`navigate-write-guard.ts:166-170`), and both `assertNavigateWriteAllowed` (`navigate-write-guard.ts:167`) and `assertAgentNavigationAllowed` (`agent-navigation.ts:78`) threw `AgentNavigationRefusedError` instead of letting `navigate` succeed with a typed kept-view result.

## Fix at the Boundary

- **`packages/core/src/action-frame.ts:69,245-253`**: Added `frame.isNavigateAction` and scoped `isStandaloneNavigateAction()` to top-level `navigate` calls (`!insideParentWriteAction()`), stopping internal read-cache SQL writes from misclassifying standalone `navigate` as a write action.
- **`packages/core/src/application-state/navigate-write-guard.ts:22-331`**:
  - Unified keep-view evaluation into a single shared `evaluateAgentNavigationPolicy()` / `evaluateNavigateWrite()` checking detail payloads on standalone `navigate` before observed-write checks.
  - Added typed `AgentNavigationKeptResult` (`{ kept: true, navigated: false, reason, currentView, message }`), `buildAgentNavigationKeptResult()`, `isAgentNavigationKeptResult()`, `isAgentNavigationRefusedError()`, `navigationKeyForCommandKey()`, and typed `reason` + `currentView` on `AgentNavigationRefusedError`.
- **`packages/core/src/application-state/store.ts:155-177,190,247,351`**: Reads the tab-scoped `navigation` state (`navigationKeyForCommandKey(key)`) under `withoutWriteObservation` when refusing a non-read-only command write and attaches `currentView` to `AgentNavigationRefusedError` without persisting the `navigate` command.
- **`packages/core/src/action.ts:1915-1934`**: Converts non-read-only `AgentNavigationRefusedError` throws inside dispatched `navigate` frames (`frame.isNavigateAction`) into `buildAgentNavigationKeptResult(thrown.reason, thrown.currentView)` (returning a successful typed result instead of throwing). Direct `navigate` writes from read-only actions and non-navigate write actions remain refused so reads and writes never move the view.
- **`packages/core/src/command-navigation/actions.ts:78-92`** & **`packages/core/src/application-state/agent-navigation.ts:55-96`**: `createNavigateAction()` evaluates the shared policy with `isNavigateAction: true`, reads `readAppState("navigation")`, and returns `buildAgentNavigationKeptResult(...)` directly (still throwing on `read-only-action`). `assertAgentNavigationAllowed()` delegates to the shared policy without overriding `isNavigateAction`.
- **Tests & Docs**: Added core unit tests (`navigate-write-guard.spec.ts`, `agent-navigation.spec.ts`, `store.spec.ts`, `command-navigation/actions.spec.ts`), a Calendar template-level spec (`templates/calendar/actions/navigate-agent-view.spec.ts`), updated `templates/tasks/actions/navigate-agent-view.spec.ts`, synced `.agents/skills/context-awareness/SKILL.md`, and added `.changeset/navigate-keeps-view-typed-result.md`.

## PRs & Commits

- **Core PR**: [BuilderIO/agent-native#9531](https://github.com/BuilderIO/agent-native/pull/9531) — merged (squash) to `main` at `bbb1fc4dabc6b0c6f6f09493606745a758b1cef5`.
- **Labs Sync PR**: [BuilderIO/agent-native-labs#333](https://github.com/BuilderIO/agent-native-labs/pull/333) (`Pin public agent-native at bbb1fc4dab`) — merged (squash) to `main` at `0f71db9bac32e26efd32a8f490a154d29f723250` (no `package.json` changes since prior `PUBLIC_PIN` `8815d89c83`).
- **Live Labs `calendar-2` served SHA**: `19bcd7915665b47b811088f99bb19d4a1d56dc17` (verified via `https://labs.agent-native.com/_labs/live-apps.json`, `runId: 44706765113`, `publishedAt: 2026-11-20T09:34:37.316Z`, descendant of `0f71db9bac`).

## Before / After (`core-calendar-move-week-no-approvals`)

- **Before** (`calendar-2 @ 73099c9d2d`, report `findings/demo-replay/73099c9d2d73047489655fd2d2abeba60ba2d644.json`):
  - `FAIL core-calendar-move-week-no-approvals [calendar-2 @ 73099c9d2d] (8172ms): navigate(after-move-day-attempt): MCP action failed (HTTP 200): Error: Refused: a write action cannot move the user's view unless intent: "open" is set. Keep the user on their current view, or use navigateAfterWrite() so agent writes stay put.`
  - `PASS 0/1 (FAIL 1, CNR 0)`
- **After** (`calendar-2 @ 19bcd79156`, report `findings/demo-replay/19bcd7915665b47b811088f99bb19d4a1d56dc17.json`):
  - `PASS core-calendar-move-week-no-approvals [calendar-2 @ 19bcd79156] (9704ms): moved gcal_event_... to 2026-11-22T19:00:00.000Z, stayed in Week view, zero approvals`
  - `checks: { actionSucceeded: true, noApprovalHold: true, appStateOk: true, dataVerified: true }`
  - `PASS 1/1 [sha=19bcd7915665 auth=qa-chrome-9455] failing: none`
