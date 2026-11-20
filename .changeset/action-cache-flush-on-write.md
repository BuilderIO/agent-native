---
"@agent-native/core": patch
---

Save the pending action query cache write as soon as a mutation succeeds or the page is hidden, so a reload right after a write no longer restores the state from before it.
