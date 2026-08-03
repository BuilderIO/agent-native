---
"@agent-native/core": patch
---

Cache peer agent cards instead of re-probing every sibling app on each lookup.
`describe-workspace-apps` ships in the default first-request tool set and the
`<available-apps>` prompt block names it, so a single turn could probe every
peer and the next turn would do it all again. Against a local dev gateway each
probe also cold-starts the app it touches, so one tool call spawned a dev server
per sibling at once and the machine stalled behind them. Cards are now cached
per caller for 30s with concurrent probes collapsed onto one request; failures
expire after 5s so a peer that was still booting is retried promptly rather than
being reported skill-less.
