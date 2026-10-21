---
"@agent-native/core": patch
---

Keep run cancellation and its terminal event atomic, and preserve persisted aborts and checkpoint failures when checkpoint persistence races driver completion.
