---
"@agent-native/core": minor
---

Add tab-scoped application-state helpers so multi-tab agents read the screen of the tab they were sent from.

- Server: `readAppStateForCurrentTab`, `writeAppStateForCurrentTab`, `appStateKeyForBrowserTab`, and `getCurrentRequestBrowserTabId` (from `@agent-native/core/application-state`). These resolve the requesting tab via `getRequestRunContext().browserTabId`, read the `key:<tabId>` value first, and fall back to the global key for CLI/external agents.
- Client: `getBrowserTabId` (from `@agent-native/core/client`), a stable per-tab id backed by sessionStorage.

The default app scaffold (`view-screen` action and `tab-id` helper) now uses these so newly generated apps are tab-correct by default.

Without tab scoping, `navigation` (and similar ambient UI state) was a single global key shared across browser tabs, so a chat in one tab could act on whatever clip/record another tab navigated to last.
