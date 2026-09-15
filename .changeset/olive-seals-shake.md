---
"@agent-native/core": patch
---

Add `sseMaxDurationMs` to cap how long the SSE endpoint holds a stream open, so a serverless deployment can close cleanly before its platform's function ceiling. Unset by default; existing behavior is unchanged. A zero, negative, or non-finite value throws when the plugin is created instead of silently disabling the cap.
