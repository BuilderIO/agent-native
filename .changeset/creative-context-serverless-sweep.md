---
"@agent-native/creative-context": patch
---

Stop running the creative-context due-job sweep and daily maintenance enqueue at serverless cold start. Production serverless runtimes now process queued imports and background jobs from the platform-scheduled recurring sweep, scan for daily maintenance hourly, and warn when no platform scheduler drives the sweep; local and long-running Node servers keep the in-process timers. The `@agent-native/core` peer range now requires `>=0.190.0`, the first release exporting every core API this package imports.
