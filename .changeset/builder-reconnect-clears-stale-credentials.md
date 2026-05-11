---
"@agent-native/core": patch
---

Builder reconnect now clears stale credentials before writing the new connection, so reconnecting with a different Builder space actually takes effect.

`writeBuilderCredentials` previously upserted each new key but left stale rows in place. Two failure modes:

- Reconnecting with a Builder space that doesn't carry every optional field (e.g. no `orgName`/`orgKind`/`userId`) left the previous connection's metadata behind at the target scope, so the gateway saw a mix of new and old credentials.
- When a user's first connect wrote at user scope (member or no-org) and a later reconnect wrote at org scope (now owner/admin), the old user-scope row still won resolution — user scope beats org scope by design — so the chat kept using the old Builder space's credentials even though the UI showed the new connection.

Fix: before writing, delete all five `BUILDER_*` keys at the target scope, and when writing at org scope also delete the writer's user-scope rows. The org-scope row is intentionally left alone when writing at user scope so a single user's personal override doesn't blow away the team's shared connection.

Reported as "I signed in again with my Builder space not my own one and still telling me I need to upgrade" on 2026-05-11.
