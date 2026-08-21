---
"@agent-native/core": patch
---

Enforce the client-above-server follow budgets against resolved configuration.

The browser's per-turn follow budgets must stay above the server's own ceilings,
because the client fires on a clock and cannot tell looping from working while
the server can. They shipped inverted once — 10 min / 6 runs against a 13-minute
legal chunk — and killed healthy turns the server was still streaming, which was
the top non-auth cause of "the chat just stopped".

That relationship was pinned in `agent-chat-adapter.spec.ts` against the
server's module constants. Making those constants configurable moved the real
values out from under the test without moving the test: a deployment could raise
`maxTurnWallClockMs`, `maxBackgroundRunContinuations`, or
`backgroundSoftTimeoutCeilingMs` past what the shipped client can follow, and
every check still passed.

The client budgets now live in `app-config/run-lifecycle-invariants.ts` (which
has no runtime imports, so the browser bundle is unaffected) and
`assertRunLifecycleInvariants` asserts all three relationships against the
resolved configuration. The spec keeps pinning the defaults — one fails fast on
a bad default, the other on a bad deploy.
