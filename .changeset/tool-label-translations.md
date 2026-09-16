---
"@agent-native/core": patch
---

Let apps translate chat tool row labels. Rows previously derived their label from the action name itself (`get-case` read "get case"), which no catalog could reach, so every non-English app showed English action names. Rows now read `agentChat.toolLabels.<action>` when the app defines it, and the derived name stays the fallback. The same lookup covers the shared conversation renderer and the live activity status line, which previously showed the stored English "Running <action>" regardless of locale. Core's own catalogs gain `activity.reasoning` and `status.runningTool` in every built-in locale.
