---
"@agent-native/core": patch
---

Core now exports the read side of `list-data-programs` and `get-data-program` from `@agent-native/core/data-programs` as `listDataProgramSummaries` and `getDataProgramDetails`, for apps that define their own same-named actions. Analytics' two actions now use them, so its MCP tools return `scheduledRefresh` and `orgSharedRun` like the framework's actions; before, a program saved with a scheduled refresh showed neither there.
