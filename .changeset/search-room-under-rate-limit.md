---
"@agent-native/core": patch
---

Meaning search gets headroom under an embedding provider's rate limit. Indexing with Builder's gateway makes at most two calls a minute per key, counted across every server, which leaves searches room under the limit the gateway gave a free space. A search refused for the rate limit holds back indexing for two minutes, and an indexing refusal holds back indexing on every server instead of each drain meeting it. An embedding family sets `documentBudget` to pace its indexing this way.
