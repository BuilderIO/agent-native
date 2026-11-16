---
"@agent-native/core": patch
---

The agent's `__url__` page state now redacts every query value except the keys an app declares: pass `urlQueryKeys` (exact names and `prefix*` patterns) to the toolkit's `AgentSidebar`. `scrubLocationState` and a `keepParams` option on `scrubUrl` are exported from `@agent-native/core/client/url-scrub`.
