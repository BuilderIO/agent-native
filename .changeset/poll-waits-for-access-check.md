---
"@agent-native/core": patch
---

Poll reads that stop at a resource event whose access check is still running now wait up to one second for that check, so the first event after the access cache expires is delivered in the same poll instead of one poll interval later.
