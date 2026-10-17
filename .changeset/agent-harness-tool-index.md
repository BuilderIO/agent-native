---
"@agent-native/core": patch
---

Help the agent find the right tool and keep chats intact across reconnects: the system prompt now names every loadable tool, grouped by topic, in its cached prefix, with MCP names delimited as untrusted data; `tool-search` ranks with BM25 (plural- and stop-word-aware) and suggests close names instead of returning nothing; the agent is told when earlier tool loads could not be restored; a reconnecting chat stream no longer re-applies events it already showed; unreadable terminal events no longer let an older outcome hide an unknown newer one; and a failed inline claim during background dispatch is retried and logged instead of looking like a worker claim.
