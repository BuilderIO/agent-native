---
"@agent-native/core": patch
---

Chat turns send the browser's time zone, and durable background runs keep it, so actions no longer quote UTC. An agent navigation command is picked up on the next data refresh instead of waiting for polling. Hashed static assets allow cross-origin reads so MCP host panels can load app chunks, an MCP host panel reads its session under its own app mount, lazy-route stylesheets load inside the panel, and `read_view` reports the panel's load errors and failed requests. Resource uploads decode non-ASCII paths, and user-scoped settings notifications stay private to their owner.
