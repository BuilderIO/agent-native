---
"@agent-native/core": patch
---

Refuse agent tool calls that pair `null` placeholders with an empty list again, unless the action sets `emptyListsEraseNothing`, so a model that pads every field can't wipe a stored list such as a Content view's hidden columns. Design's `generate-design` sets it and keeps running under GPT-6 Luna.
