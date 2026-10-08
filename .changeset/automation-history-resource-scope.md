---
"@agent-native/core": patch
---

Record scheduled automation runs under the automation's stored owner and scope so personal jobs show their scheduled and manual executions together in Past runs.

Return that same stored-owner scope to Dispatch's automation list so personal jobs with legacy execution organization metadata query their personal run history.

Add an opt-in maintenance backfill that moves completed misfiled history to personal scope only when execution traces identify one stable job id and the matching stored owner.
