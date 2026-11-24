---
"@agent-native/core": minor
---

Actions can live in subfolders of `actions/`; the name is the relative path joined with `-` (`billing/create-invoice.ts` is `billing-create-invoice`), and two files resolving to one name fail boot. `tool-search` returns exactly the tools named when a query is only known action names, and its description no longer pushes `includeSchemas`. Saved automations now apply the app's `resolveActionSurface`, so excluded tools are neither discoverable nor callable from them (`details.automation` is set and `details.event` is undefined for those runs).
