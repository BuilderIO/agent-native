---
"@agent-native/core": patch
"@agent-native/agentkit": patch
---

Keep a stopped chat reply's text the same live and after reload: the browser keeps what the server streamed before the stop and saves its copy, and a run whose Stop reached another server still saves its reply.
