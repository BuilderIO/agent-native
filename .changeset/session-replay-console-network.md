---
"@agent-native/core": minor
---

Session replay now captures browser console logs and network request metadata while recording, emitted as tagged rrweb custom events (`agent-native.console` / `agent-native.network`). Capture is on by default when session replay is enabled and configurable via new `console` / `network` options (boolean or object) on the session replay config. Request/response bodies and headers are never captured, URLs are scrubbed, messages are truncated, recorder self-traffic is excluded, and per-session budgets (1000 console / 2000 network events) add a truncation notice.
