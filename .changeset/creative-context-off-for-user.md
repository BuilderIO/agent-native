---
"@agent-native/creative-context": patch
---

Add `isCreativeContextOffForUser`, which reports when the lab is unavailable to the user or their saved preference is off, so callers can drop reuse labels that `validateGenerationCreativeContext` would refuse.
