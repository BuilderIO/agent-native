---
"@agent-native/core": patch
---

Replace the Groq models that Groq shut down. Groq's default model is now `openai/gpt-oss-120b`, the models offered are `openai/gpt-oss-120b` and `openai/gpt-oss-20b`, and voice cleanup through Groq uses `openai/gpt-oss-120b` with low reasoning effort so it stays inside its timeout.
