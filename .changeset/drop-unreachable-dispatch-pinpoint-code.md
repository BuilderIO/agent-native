---
"@agent-native/dispatch": patch
"@agent-native/pinpoint": patch
---

Shrink the dispatch and pinpoint install footprint by removing code and
dependencies nothing could reach. Dispatch drops the unused pre-auth routing
helper — `rootDispatchRedirect` had no callers and was not re-exported from
`./server` or any other published subpath — along with the `@libsql/client` and
`h3` dependencies, which had no imports in the package but were still installed
for every consumer. Pinpoint drops the `HistoryDropdown` and `SettingsPanel`
overlay components, which were never rendered by the overlay and were not
reachable from any of its `.`, `./react`, `./primitives`, `./server`, or
`./types` entry points. No exported API changes.
