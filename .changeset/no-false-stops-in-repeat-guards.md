---
"@agent-native/core": patch
---

Stop the new repeat-loop guards from killing turns that would have succeeded: network "connect … before/first" failures and retention-window "only available in …" errors no longer read as permanent preconditions, per-item errors that differ only by id (`Record 41 not found`) are counted separately again, the permanent-precondition stop keeps the raw tool error in `details` like every other terminal stop, an explicit `recoverable: false` outranks the message sniff, a single ledger-read blip is retried before the turn stops, and the persisted-thread rebuild scopes retry clears exactly like the live client so narration no longer vanishes on reload.
