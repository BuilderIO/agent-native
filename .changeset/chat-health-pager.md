---
"@agent-native/core": patch
---

Page owners and admins when an app's chat stops answering. The detector already
existed as `scripts/chat-health.mjs --strict`, but nothing ran it and nothing
alerted, so a sustained outage was found by a user posting in Slack. The same
turn-scoring now runs on the durable sweep that already drives stale reaping,
scoped to the app it runs in so no cross-app credential is needed. "Not enough
turns to judge" and "could not read the ledger" are distinct outcomes from
"healthy" — a check that could not run never reports all-clear.
