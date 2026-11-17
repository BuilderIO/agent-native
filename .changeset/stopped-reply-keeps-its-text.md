---
"@agent-native/core": patch
"@agent-native/agentkit": patch
---

Keep a stopped chat reply's text the same live and after reload: Stop tells the server the last part of the reply the browser showed, the server saves the reply only up to there, and a run whose Stop reached another server still saves its reply.
