---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Answer chat turns the server refuses before a run starts (AI setup missing, no usable model credential) in the thread itself: the prompt and a typed failed run are persisted server-side, the chat shows the connect card with a retry, and the refused prompt is sent again once after Builder or a provider key is connected. Run lifecycle analytics now carry the canonical user id from the request context and count refused turns as `run_no_reply`.
