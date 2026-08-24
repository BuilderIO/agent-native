---
"@agent-native/core": patch
---

Fix PostHog LLM analytics showing the assistant's reply as part of the prompt. The agent loop appends its own turns to the message array it is handed, and the trace read that array after the run, so `$ai_input` / `$ai_input_state` carried the run's final transcript instead of its request — PostHog rendered the same assistant message in both Input and Output. The request is now snapshotted before the loop can grow it.
