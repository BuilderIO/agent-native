---
"@agent-native/core": patch
---

Bound one stale-run reap pass and stop swallowing per-row reap failures. `reapAllStaleRuns` now returns `{ reaped, failed, truncated }` instead of a bare count, so a pass where every row threw is no longer indistinguishable from "nothing was stale", and a pass that hit the batch cap is no longer reported as a clean sweep.
