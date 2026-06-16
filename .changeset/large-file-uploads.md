---
"@agent-native/core": patch
---

Builder file upload provider now routes files over 30 MB through a signed-URL flow (request URL → direct storage PUT → register asset), so large uploads no longer hit the ~32 MB request cap. Smaller files keep the existing direct-POST path with retries.
