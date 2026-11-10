---
"@agent-native/core": minor
---

Add server-only `agent.promptSkills.includeSupportingFiles` (default `true`) to control generated supporting-file listings in the shared system-prompt loader without changing authored skill text or reference read access. Refill resource-backed skill listings in bounded batches so excluded and duplicate candidates do not consume available slots, with an inspection-limit notice when candidates remain uninspected.
