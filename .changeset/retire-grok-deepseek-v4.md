---
"@agent-native/core": patch
---

Stop offering Grok Code Fast and DeepSeek V4 Pro through Builder. Their upstream models were retired, so every request failed with a gateway internal error. Saved selections fall back to the default model.
