---
"@agent-native/core": patch
---

Send action tools to the OpenAI Responses API as non-strict, so models can omit optional parameters instead of filling every one with a placeholder that validation rejects.
