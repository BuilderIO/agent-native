---
"@agent-native/core": patch
---

MCP tool calls by a signed-in user now read and write tab-scoped app state (navigation, navigate commands, selection) for the tab of the app they used last, instead of account-wide rows no tab keeps current. When no tab was used in the last 12 hours, navigation reads come back empty and the tool result says so. Apps with their own navigation sync can record tab use with `useBrowserTabUse`.
