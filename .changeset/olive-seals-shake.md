---
"@agent-native/core": patch
---

Add `sseMaxDurationMs` to cap how long the SSE endpoint holds a stream open, so a serverless deployment can close cleanly before its platform's function ceiling. Unset by default; existing behavior is unchanged.
