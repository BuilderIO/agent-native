---
"@agent-native/core": patch
---

Fix agent-teams reliability: untruncated sub-agent results (50k char cap), proper engine resolution via resolveEngine in \_process-run, progress-aware continuation budget with no-progress detection, sub-agent token accounting with labeled usage recording, and double-claim fencing via attempts counter on heartbeat/bump/finalize writes.
