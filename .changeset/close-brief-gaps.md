---
"@agent-native/core": patch
---

Close two acceptance-criteria gaps from the background-run hardening.

A hard-aborted run reached PostHog carrying "Agent run was aborted" —
byte-identical to what a user pressing Stop produces, because the abort is what
the loop observes and `$ai_error` derives its code from the terminal outcome.

Fixed at that source rather than per-caller: the agent-loop wrapper now reports
a server-owned abort reason as a `failed` outcome carrying that reason as its
code, which is what its own no-timeout path has always done. The code therefore
reaches `$ai_error` through the existing construction, for every entry point
rather than just automations. The reason set is an allowlist, not "anything that
isn't `user`", because the abort route accepts a client-supplied reason string
and an inverted test would relabel a genuine Stop.

`backgroundSoftTimeoutCeilingMs` is not merely a bound — it IS the clamp
`resolveRunSoftTimeoutMs` reduces every background soft timeout to. Making it
configurable therefore left the one number that keeps a chunk inside the host's
background-function wall unbounded, so a deployment could raise it past that
wall and turn every long background turn back into the silent platform kill the
ceiling exists to prevent. The invariant check now asserts it against
`BACKGROUND_FUNCTION_WALL_MS` minus the headroom a chunk needs to checkpoint;
the shipped 13-minute value sits exactly on that margin.
