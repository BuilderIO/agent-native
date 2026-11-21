---
"@agent-native/core": patch
---

Honor the `x-agent-native-browser-tab` header on authenticated MCP tool calls when resolving the call's `browserTabTarget` for tab-scoped application state (`navigation`, `navigate`, and tab selection), falling back to the user's most recently used tab when the header is absent or malformed. `getCurrentRequestBrowserTabId()` remains `null` for MCP calls so editor-origin checks stay enforced.
