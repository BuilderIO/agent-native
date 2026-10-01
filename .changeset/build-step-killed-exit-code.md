---
"@agent-native/core": patch
---

`agent-native build` now reports a Vite or Nitro step that was killed by a signal instead of exiting with a bare code 1: it prints which signal stopped the step (flagging SIGKILL as a likely out-of-memory kill) and exits with 128 plus the signal number, such as 137 for SIGKILL. `agent-native deploy` uses that code to say when a workspace app build likely ran out of memory, whether builds run one at a time or in parallel.
