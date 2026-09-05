---
"@agent-native/core": patch
---

External MCP/WebMCP surfaces now hide turn-ending in-app question actions (`endsTurn: true`) by default and accept tool inputs/results up to 500,000 characters, so external agents author and save whole screens, decks, and documents directly instead of stalling on an in-app answer or hitting the old 20k/50k character caps.

The page-local WebMCP action bridge and the generic action HTTP route now resolve the calling browser tab id from the same `X-Request-Source` header the frontend action client already sends, so `getRequestRunContext()?.browserTabId` (and therefore `readAppStateForCurrentTab`) scopes navigation/selection app-state reads and writes to the tab that actually made the call instead of whichever tab last wrote the global key — fixing cross-tab state corruption on every WebMCP call and on direct action calls that omit tab scoping.

`getBrowserTabId()` now also absorbs the duplicate-tab claim protection (a stored `{tabId, ownerId, active}` claim plus a `BroadcastChannel` ack/reload backstop) that only Slides previously implemented on its own, so every template's tab-scoped app-state keys use one consistent, server-matching id instead of each app minting its own.
