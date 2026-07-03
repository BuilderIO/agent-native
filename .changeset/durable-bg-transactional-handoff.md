---
"@agent-native/core": patch
---

Make durable background chat runs reliable end-to-end: continuation handoffs are now transactional (the successor run row is inserted before dispatch, the dispatch response is fully awaited with retries instead of racing a 250ms settle timer from a finishing Lambda, and a lost handoff is reaped into a loud error by a new unclaimed-run sweep instead of hanging silently); background dispatch bodies stay under Netlify's 256KB background-function cap by persisting the chat payload on the run row and rehydrating it in the worker; a run-manager-level no-progress backstop covers stall segments the in-loop watchdogs never see; and a durable SQL per-turn run budget bounds pathological continuation loops across every recovery path.
