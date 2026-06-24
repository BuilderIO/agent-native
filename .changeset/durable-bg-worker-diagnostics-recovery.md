---
"@agent-native/core": patch
---

Make durable-background agent-chat worker failures diagnosable from the client
and harden recovery when the background worker never starts.

A durable-background run is dispatched into a Netlify `-background` function,
which acks asynchronously with a 202. If that worker then dies silently (its
logs are not readable from the build tooling), the run would just time out with
no clue why, and because dispatch already returned 202 the existing fast-fail
inline fallback never engaged — so the run errored opaquely.

Diagnostics (readable WITHOUT bg-fn logs). The `_process-run` worker pipeline
now records the last reached stage onto the run row (`agent_runs.diag_stage`, a
compact JSON `{stage,detail?,at}`) via the new best-effort `recordRunDiagnostic`:
route entered, HMAC auth pass/fail (recorded onto the run BEFORE the 401/503 is
returned, including whether `A2A_SECRET` is present in the bg-fn isolate),
worker entered (with the resolved `runsInBackgroundFunction` value), claim
win/lose, worker loop started, and any thrown error. `/runs/active?threadId=`
(and `listRunsForThread`) now surface `dispatchMode` and `diagStage`, so the
next prod run's death cause is readable straight from the client.

Recovery (covers "202 acked but worker never started"). A background-dispatched
run that is still unclaimed (`dispatch_mode = 'background'`, never flipped to
`background-processing`) past a tight 25s grace is reaped early and recoverably
with the new `background_worker_never_started` error code (the wide 90s window
only exists to protect a CLAIMED, cold-starting worker — an unclaimed run has no
worker to protect). The `/runs/active` read path attempts this recovery before
the generic stale reaper, so a silent worker death surfaces as a recoverable
error the client can re-drive instead of hanging for 90s.

Also fixes a latent gate: `/_agent-native/agent-chat/_process-run` now bypasses
the session-auth guard (mirroring the agent-teams processor). The self-dispatch
carries only an HMAC Bearer token and no session cookie, so without the bypass
the worker was 401'd before it could authenticate and claim the run.
