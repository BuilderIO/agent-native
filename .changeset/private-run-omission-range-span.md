---
"@agent-native/core": patch
---

Saving a chat that ran a private action (such as an import) no longer fails with a server error. Redacting the private run now keeps how far each omitted event range reaches, so the saved events still validate and the "Save failed" notice no longer appears.
