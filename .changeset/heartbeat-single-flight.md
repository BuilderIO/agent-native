---
"@agent-native/core": patch
---

Single-flight the agent run heartbeat write so a run holds at most one Neon connection for liveness. The 1.5s heartbeat timer previously fired a fresh write every tick regardless of whether the prior one was still in flight; under Neon pooler saturation (writes taking up to the ~8s DB timeout) this piled up ~5 concurrent heartbeat connections per run, adding to the connection-cap exhaustion that starves the heartbeat and gets the still-alive run false-reaped as stale. The abort and no-progress-backstop checks still run every tick.
