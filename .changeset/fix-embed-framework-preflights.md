---
"@agent-native/core": patch
---

Avoid CORS preflight storms for embedded framework polling by using query-token auth on safe `/_agent-native` GET requests.
