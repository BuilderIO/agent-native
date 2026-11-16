---
"@agent-native/core": patch
---

Let the MCP endpoint trust the local owner hint when an app runs under `agent-native dev`. The dev server serves the app from a worker behind the Vite proxy, so the request's `Host` port never matched the worker's own socket port and every local MCP call with `x-agent-native-owner-email` got a 401. The port check is now skipped for MCP requests when `NODE_ENV` is `development`; every other check (literal `127.0.0.1` Host, loopback peer and socket, no forwarded headers, same-origin) still applies, and production builds are unchanged.
