---
"@agent-native/core": patch
---

Stop refusing agent tool calls that pair `null` placeholders with an empty list, which left models that pad every field, such as GPT-6 Luna, unable to run Design's `generate-design`.
