---
"@agent-native/core": patch
---

diag(agent): add a `worker_stage` column that records the durable background worker's last-reached setup stage independently of the foreground inline-recovery `setup_timings` write, plus early `engine_resolved` / `systemprompt_enter` / `systemprompt_done` markers. `/runs/active` now surfaces `workerStage`, so a worker that stalls before claiming its run is diagnosable (which exact step it reached) without the unreadable Netlify background-function logs.
