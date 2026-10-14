---
"@agent-native/core": patch
---

Reuse one tokenizer for context token counts instead of rebuilding it on every call, removing seconds of delay before each agent model call on long threads.
