---
"@agent-native/core": patch
---

Validate converged collaborative text before persistence or broadcast so application-level guards can reject unsafe concurrent merges without exposing transient invalid state to connected clients.
