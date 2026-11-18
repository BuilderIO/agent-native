---
"@agent-native/core": patch
---

Add `agent-native capture-evidence`, a bounded single-session browser capture that writes an evidence manifest for a page effect: actual viewport and DPR, selection geometry and styles, CSS animation and timed motion facts, WebGL uniform and draw facts with a visible static-fallback status, and hashed relevant source slices, each with per-operation and total timeouts and explicit partial or failed outcomes.
