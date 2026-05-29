---
"@agent-native/core": patch
---

Harden agent chat continuation across serverless timeouts. Fixes several cases where a turn that hit a timeout would error or stall instead of resuming: (1) a tool still in flight when the timeout fires now counts as progress, so the client no longer gives up in ~2s with "connection kept failing" while the server is actively working; (2) the empty-continuation cap is measured by real content (not bare part count) so whitespace-only output can't mask a stall; (3) large tool inputs (create-extension / update-extension HTML) are preserved verbatim in continuation history instead of degrading to a lossy placeholder, so the agent can keep refining; (4) the run-manager terminal/auto_continue event seq is stamped at emit time so late events can't collide and silently drop the continuation signal.
