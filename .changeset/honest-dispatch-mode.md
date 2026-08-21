---
"@agent-native/core": patch
---

Stop reporting every unlabelled agent run as `foreground`.

`emitRunTerminalTrackingEvent` defaulted `dispatch_mode` to `"foreground"` when
a caller passed none — and the interactive chat handler is the only caller that
passes one. Five others (background automations, agent teams, webhook handlers,
harness runs, the docs poller) passed nothing, so the default was wrong every
single time it applied.

Measured consequence: on one deployment, scheduled and manually-dispatched
automation runs were failing with `no_progress` at 6 of 7 while interactive chat
sat at 2 of 190 — and both were labelled `foreground`, so the failing path was
indistinguishable from the healthy one in the only view where anyone would have
looked.

`dispatch_mode` is now absent when the caller did not supply one, so "not
recorded" and "was foreground" stop being the same value, and the background
automation runner passes the `"background"` it already writes onto its own run
row. Passing it cannot disturb the runner's self-claim: `insertRun` is
`ON CONFLICT DO NOTHING`, so `startRun`'s insert is a no-op for a claimed row.
