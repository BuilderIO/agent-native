---
"@agent-native/core": patch
---

External MCP/WebMCP surfaces now hide turn-ending in-app question actions (`endsTurn: true`) by default and accept tool inputs/results up to 500,000 characters, so external agents author and save whole screens, decks, and documents directly instead of stalling on an in-app answer or hitting the old 20k/50k character caps.

The page-local WebMCP action bridge now sends the calling browser tab id (`X-Agent-Native-Browser-Tab`, the header the action routes resolve into `getRequestRunContext()?.browserTabId`), so `readAppStateForCurrentTab` scopes navigation and selection reads for a WebMCP call to the tab that made it instead of whichever tab last wrote the global key.
