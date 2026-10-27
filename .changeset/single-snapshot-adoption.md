---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Take a newer saved body into a shared live document once, however many editors have it open. Each open editor used to apply it to its own copy, and the merge kept every copy, so the text appeared twice.
