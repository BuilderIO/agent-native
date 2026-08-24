---
"@agent-native/core": patch
---

Report failures at the layer that failed, and never as a bare flag. `$ai_is_error` could travel without any `$ai_error` — every failed tool span did exactly that with the default `captureToolResults: false`, so PostHog showed "error" and nothing else. All three emitters now fall back to a stated reason, add PostHog's `$ai_error_type`, and say when a tool's error text was withheld rather than never reported. The levels mean distinct things: a generation is failed only when the model call itself failed (a provider error or a stream dropped mid-call), a span when the tool crashed or returned an error, and the trace for everything else — step budgets, timeouts, no-progress cut-offs. A tool that stopped the run no longer marks the model call that preceded it as failed, and a run's terminal outcome rides only the layer that actually failed.
