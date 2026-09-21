---
"@agent-native/core": minor
---

Stop forcing `reasoning_effort: "none"` for GPT reasoning models (Luna/Terra/Sol) with tools on the Builder gateway. That guard was based on a Chat Completions rejection actually observed on a different engine/proxy; the Builder gateway has always routed these models through OpenAI's Responses API, which accepts reasoning effort alongside tools — confirmed via a live gateway request. The requested effort is now forwarded unconditionally.
