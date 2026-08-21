---
"@agent-native/core": patch
---

Close two acceptance-criteria gaps from the background-run hardening.

A hard-aborted automation reached PostHog carrying "Agent run was aborted" —
byte-identical to what a user pressing Stop produces, because the abort is what
the loop actually observes. The taxonomy code the runner already computed never
left the process. `classifyBackgroundAutomationTraceError` now hands
`background_automation_hard_timeout` to `instrumentAgentLoop`'s `classifyError`
hook, so the two failures are distinguishable in the one view you go to to tell
them apart.

`backgroundSoftTimeoutCeilingMs` is not merely a bound — it IS the clamp
`resolveRunSoftTimeoutMs` reduces every background soft timeout to. Making it
configurable therefore left the one number that keeps a chunk inside the host's
background-function wall unbounded, so a deployment could raise it past that
wall and turn every long background turn back into the silent platform kill the
ceiling exists to prevent. The invariant check now asserts it against
`BACKGROUND_FUNCTION_WALL_MS` minus the headroom a chunk needs to checkpoint;
the shipped 13-minute value sits exactly on that margin.
