---
"@agent-native/core": patch
---

Allow bounded, abortable waits for agent task status and results, and keep volatile read-only task checks fresh throughout an agent turn.

Save sub-agent results within their active task transaction while retaining execution lease checks and atomic rollback.
