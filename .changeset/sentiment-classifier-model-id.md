---
"@agent-native/core": patch
---

The inferred-sentiment classifier now defaults to `gpt-6-luna`, a model the Builder gateway lists (the retired `gpt-5-6-luna` made every hosted classification fail as `engine_unavailable`), and an engine that does not list the configured model now reports the distinct `$ai_sentiment_failed` reason `model_unsupported`.
