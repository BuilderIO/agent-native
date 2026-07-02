---
"@agent-native/core": patch
---

The collaborative reconcile applies external content on a timer task instead of a microtask, so `setContent` can no longer run inside a React lifecycle flush ("flushSync was called from inside a lifecycle method" console errors during collab reconciliation).
