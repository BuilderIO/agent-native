---
"@agent-native/core": patch
---

Stop rewriting session-replay Meta and ViewportResize dimensions at capture so stored frames stay aligned with the FullSnapshot DOM, while display sizing still clamps extreme aspect ratios.
