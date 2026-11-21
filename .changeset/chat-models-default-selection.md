---
"@agent-native/core": patch
---

`useChatModels` now returns `defaultSelection`, the model and engine a picker starts on before anyone chooses. A host that keeps an unavailable saved choice, such as Content's comment AI, can offer the same default the other pickers use.
