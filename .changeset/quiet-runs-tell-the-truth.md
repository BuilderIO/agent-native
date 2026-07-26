---
"@agent-native/core": patch
---

Harden agent run lifecycle recovery: sweep stale claimed runs on the fast
periodic interval instead of only from client request paths, persist the
partial turn on a no-progress recovery abort, emit reason-shaped terminal
events (`auto_continue` / reason-coded error) instead of a synthetic `done`,
make the chunk-boundary checkpoint durable the moment the soft timeout fires,
and derive the foreground no-progress backstop and tool-timeout ceiling from
the chunk budget so they can actually fire.
