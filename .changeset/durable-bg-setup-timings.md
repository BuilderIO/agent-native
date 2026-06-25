---
"@agent-native/core": patch
---

Add diagnostic-only pre-`startRun` setup-timing instrumentation to the agent-chat
handler. Captures wall-clock offsets from handler entry through the work done
before the agent loop starts — body parse, request prep, system-prompt build,
screen context, the parallel context-collection `Promise.all`, action/tool
conversion, and thread data — and emits them as a `setup_timings` run diagnostic
(readable via the run's `diag_stage`). No behavior change; best-effort and
fire-and-forget. It lets us localize which setup bucket dominates pre-run latency
on heavy apps — e.g. analytics, whose >25s setup currently exceeds the durable
claim grace — and runs on both the inline and background-worker paths, so the
breakdown can be measured with durable left OFF.
