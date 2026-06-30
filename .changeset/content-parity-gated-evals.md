---
"@agent-native/core": patch
---

Report intentionally gated eval cases as skipped, keep skipped suites from setting up agent runners, and avoid action/engine setup for eval cases that fully short-circuit with custom run handlers.
