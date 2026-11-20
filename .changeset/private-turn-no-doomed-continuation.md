---
"@agent-native/core": patch
---

Stop auto-continuing a private turn into a continuation that cannot resume it, so saving a draft no longer ends with "Private content omitted", and keep the real framework error code on failed private runs.
