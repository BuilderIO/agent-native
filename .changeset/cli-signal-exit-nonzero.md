---
"@agent-native/core": patch
---

The CLI now exits nonzero when a child process is killed by a signal, instead of reporting exit 0.

`run()` ended with `process.exit(code ?? 0)`, and a child killed by a signal has a null code, so a SIGKILLed step (the case in hand: `tsc` during a Slides preflight) looked like a pass and the preflight went green. A signal exit is now `128 + <signal number>` (137 for SIGKILL, 143 for SIGTERM, 130 for SIGINT) — nonzero for any caller that asks "did it fail", and still the signal for one that asks which. An exit that cannot be classified (no code, no known signal) exits 1, never 0.
