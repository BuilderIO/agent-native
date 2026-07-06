---
"@agent-native/core": patch
---

Defer collaborative rich-markdown seed writes to a timer task so initial Y.Doc seeding does not call `setContent` from React lifecycle.
