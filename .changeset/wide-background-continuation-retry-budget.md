---
"@agent-native/core": patch
---

Fix a bug where a durable-background agent run could be killed by a single transient network blip during its soft-timeout chunk handoff. A worker proven to be running inside a real background function now gets a retry budget sized for its remaining wall-clock time (5 attempts / 15s timeout) instead of being silently demoted to the smaller foreground budget just because it was forced onto the same-process dispatch target.
