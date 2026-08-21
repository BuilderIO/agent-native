---
"@agent-native/core": patch
---

Let a manual automation run target a resource path, so automations nested under `jobs/` (such as per-factory jobs) can be run immediately instead of failing with "A valid automation name is required." Preserve application-owned frontmatter when automation status is written back after a run, and dispatch local runs back to the active development server instead of an inactive legacy port.
