---
"@agent-native/core": patch
---

Send `reasoning_effort: "none"` instead of omitting it when a custom OpenAI base
URL forces Chat Completions with tools present. Omitting the field let OpenAI
apply the model's own default effort, so GPT-5.6 runs kept failing with
"Function tools with reasoning_effort are not supported for <model> in
/v1/chat/completions" even after the field was dropped.
