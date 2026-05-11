---
"@agent-native/core": minor
---

Two related additions to the realtime + agent layer:

- **Per-source change-version primitive.** New `useChangeVersion(source)` / `useChangeVersions(sources)` / `getChangeVersion` / `bumpChangeVersion` exported from `@agent-native/core/client`. Every `recordChange` event carries a `source` and `version`; `useDbSync` now bumps a per-source counter on each event and templates fold the counter into their React Query `queryKey`, so a change to `"dashboards"` only refetches dashboard queries instead of triggering a blanket cache invalidate across the app. Framework-level keys (`action`, `extension`, `application-state`, …) keep their universal invalidate; template data keys (`data`, `dashboards`, `analyses`, `dashboard-views`) no longer do — they react through the per-source counter. Analytics templates updated as the first consumer (CommandPalette / Sidebar / sql-dashboard / AnalysesList).
- **Scoped chat tabs in `AgentPanel` / `MultiTabAssistantChat`.** New optional `scope?: ChatThreadScope | null` prop on `AgentPanel`. When set, the tab bar partitions per `(storageKey, scope)` so each deck / dashboard / record shows its own thread list, new chats inherit the scope server-side, and the panel renders a "Working on {label}" badge with a Detach button to escape back to the unscoped tab list. Pairs with the server-side `scope_type` / `scope_id` / `scope_label` columns + `setThreadScope` already in `chat-threads/store.ts`.
