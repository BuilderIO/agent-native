---
"@agent-native/core": patch
---

Route the durable background-function worker's Neon queries over the stateless
HTTP transport (`poolQueryViaFetch`) instead of a long-lived WebSocket pool
connection. A frozen/thawed bg-fn instance can leave the WebSocket half-dead, so
every query after the first burst stalls on connect()/query() — the analytics
worker stalled right after model resolution and never claimed its run. The
foreground keeps the WebSocket pool.
