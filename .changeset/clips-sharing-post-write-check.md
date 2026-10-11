---
"@agent-native/core": patch
---

Re-run the `assertSharingChange` hook after a share grant or visibility change is written, and undo that write if the hook refuses, so a context item that commits mid-change cannot leave a shared clip behind.
