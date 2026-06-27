---
"@agent-native/core": patch
---

Require signed-in email identity for browser session replay by default across templates and send replay timing/event-count metadata with each upload. Apps that intentionally record anonymous replay sessions can opt out with `sessionReplay.requireSignedInUser: false` or `VITE_AGENT_NATIVE_SESSION_REPLAY_REQUIRE_AUTH=false`.
