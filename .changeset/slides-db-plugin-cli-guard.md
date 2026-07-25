---
"@agent-native/core": patch
---

Fix every `pnpm action` in a Slides app failing with "nitroApp.h3 is not available" — the Slides db plugin now skips readiness-gate middleware registration when invoked by the CLI runner, which supplies no h3 app.
