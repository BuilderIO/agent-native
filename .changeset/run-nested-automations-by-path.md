---
"@agent-native/core": patch
---

Let a manual automation run target a resource path, including the generic `run-automation-now` action and manage-automations `run-now` tool, so automations nested under `jobs/` (such as per-factory jobs) can be run immediately instead of failing with "A valid automation name is required." Preserve application-owned frontmatter when automation status is written back after a run, and dispatch local runs back to the inbound request host when present.
