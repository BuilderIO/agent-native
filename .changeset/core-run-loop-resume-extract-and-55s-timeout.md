---
"@agent-native/core": patch
---

refactor(agent): extract `runAgentLoopDirectWithSoftTimeout` (the soft-timeout + resumable-error continuation wrapper) out of `agent-chat-plugin.ts` into a dedicated `run-loop-with-resume.ts`, with unit and integration spec coverage for the soft-timeout path, gateway-timeout resume, network-interrupt resume, the `MAX_RUN_LOOP_CONTINUATIONS=6` cap, and upstream-abort handling.

Also bumps `DEFAULT_BUILDER_GATEWAY_TIMEOUT_MS` from 45s to the existing 55s cap so design generation and other long-output workloads get the full per-call budget Lambda's 75s function limit allows. 55s leaves ~20s headroom for response streaming + the soft-timeout continuation path.
