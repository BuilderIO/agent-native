---
"@agent-native/core": patch
---

Event automations no longer stop firing in a serverless instance whose startup database read timed out. The trigger dispatcher now does no database work at plugin init: it loads which events have automations when the first event is emitted, retries that load on the next event after a failure instead of treating it as "no automations", and reloads it every minute so automations created on another instance are picked up. Adds `subscribeAll` to the event bus and `hasEventAutomation` to `@agent-native/core/triggers`.
