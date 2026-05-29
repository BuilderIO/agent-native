---
"@agent-native/core": patch
---

Cap the per-message `<current-screen>` context so a large `view-screen` snapshot (e.g. a recording/meeting page returning a full transcript + every segment) can no longer overflow the model context window and hard-error the chat with `context_length_exceeded`. The screen snapshot injected into every user message is now bounded to ~24K chars with a note pointing the agent at `view-screen` / data actions for full detail. This fixes brand-new chats failing on the first message and the very high time-to-first-token caused by an oversized ambient context.
