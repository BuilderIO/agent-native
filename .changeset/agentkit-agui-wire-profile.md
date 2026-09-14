---
"@agent-native/core": patch
"@agent-native/agentkit": minor
---

**Breaking (pre-1.0):** AgentKit protocol v2 intentionally rejects v1-only
peers because the AG-UI envelope is not wire-compatible with the original
Builder envelope. Upgrade the AgentKit client and server together, then rerun
transport conformance before deploying a custom adapter. The deprecated
`resolveApproval` API remains only as a source-compatibility bridge after both
peers are on v2.

Carry AgentKit runs over the AG-UI wire format instead of a Builder-only
envelope. Overlapping events map onto native AG-UI event types, and the
Builder-specific events travel as a versioned typed extension profile over
`CUSTOM`, so a stock AG-UI client can read the stream while AgentKit consumers
still receive fully typed domain events. Sequencing, replay cursors, and profile
version negotiation are defined as explicit extensions because AG-UI specifies
none of them. Approvals now use AG-UI's interrupt model: the Core transport
exposes `resumeRun` with `resume` entries in place of `resolveApproval`. An
approval interrupt terminally closes its protocol run, and `resumeRun` returns
the distinct replacement run that carries the resolution and continued work.
