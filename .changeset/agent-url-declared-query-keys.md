---
"@agent-native/core": patch
---

The agent's `__url__` page state now redacts every query value except the keys an app declares, attribution parameters (`utm_*`, `gclid`, `ref` and the rest) included: pass `urlQueryKeys` (exact names and `prefix*` patterns) to the toolkit's `AgentSidebar`. `scrubLocationState` and `scrubUrl`'s `keepParams` and `keepAttribution` options are exported from `@agent-native/core/client/url-scrub`.
