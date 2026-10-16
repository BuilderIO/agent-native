---
"@agent-native/core": patch
---

Twelve framework migration lists that ran only in the release step (tool approvals, OAuth tokens, chat-thread schema, observability, agent runs, harness sessions, usage alerts, remote devices, identity SSO, workspace connections, automation runs and scheduler health) now belong to the stores that own their tables and are recorded in `_an_store_migrations`. Existing databases import the history those lists already recorded, so nothing re-runs.
