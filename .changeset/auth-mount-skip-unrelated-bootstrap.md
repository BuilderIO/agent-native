---
"@agent-native/core": patch
---

Fix a cold-start latency bug where `/_agent-native/auth/session` (and the
other early auth/sign-in routes) waited for the entire default-plugin
bootstrap chain — agent-chat, org, integrations, and every other unrelated
default plugin — before Better Auth even mounted. The default (non-BYOA)
branch of `createAuthPlugin` now marks its own routes ready and mounts
Better Auth the same way the BYOA branch already did: without serializing
behind `awaitBootstrap`. Better Auth and the DB client are lazy singletons
that only need the database reachable when a request actually runs, not
anything the rest of bootstrap sets up.
