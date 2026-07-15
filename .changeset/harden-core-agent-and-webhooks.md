---
"@agent-native/core": patch
---

Prevent repeated read-only tool loops while preserving trimmed results, allow volatile reads to opt out of deduping, and enforce notification webhook allowlists at the scope that supplied each secret.
