---
"@agent-native/creative-context": patch
---

Stop running the creative-context due-job sweep and daily maintenance enqueue at serverless cold start. Production serverless runtimes now process queued imports, background jobs, and daily maintenance from the platform-scheduled recurring sweep; local and long-running Node servers keep the in-process timers.
