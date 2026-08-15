---
"@agent-native/core": patch
---

Recover conversation history on the server when a foreground turn arrives without any. The client trims history against a size budget, so a single tool-heavy turn could reduce it to nothing — and downstream that is indistinguishable from the first message of a new thread. An existing thread now falls back to a bounded, text-only window of what was said, so the agent stops re-deriving answers it already gave. A new contract test covers the client-trim → wire → engine-messages seam, where unit tests on both halves passed while the conversation went missing between them.
