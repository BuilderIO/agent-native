---
"@agent-native/core": patch
---

Targeted text edits now say why a find missed when the find has `\n`-style escapes where the stored text has real line breaks, and export `findEditThatRemovedText` and `editRemovedTextMessage` so ordered edit batches can name the earlier edit that changed a later edit's text.
