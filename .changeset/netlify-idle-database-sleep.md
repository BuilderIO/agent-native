---
"@agent-native/core": patch
---

Let a standalone Netlify app's scale-to-zero database sleep while the app is idle. The minute recurring-jobs function now skips the sweep, without touching the database, until a visitor arrives or something the sweep handles falls due, and sweeps at least once an hour (`AGENT_NATIVE_IDLE_SWEEP_MAX_MINUTES`; `0` restores the every-minute sweep). Sweep handlers can report when their work is next due through `registerRecurringSweepHandler`'s `nextDueAt`.

The Netlify guide adds the `A2A_SECRET` and make-it-public steps that automations need, deploy commands that work on Windows, and a section on automations and an idle database.
