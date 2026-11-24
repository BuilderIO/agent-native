---
"@agent-native/core": patch
---

Each sync event a poll skips as unreadable is now counted in the `agent_native.sync.unreadable_events` metric, by cause, next to the existing server log, so a feed that keeps skipping events shows up on dashboards and alerts.
