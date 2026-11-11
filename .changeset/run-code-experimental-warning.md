---
"@agent-native/core": patch
---

`run-code` output is cleaner: it no longer includes Node's `--allow-net` ExperimentalWarning in stderr on every run, and stdout and stderr are separated by one blank line instead of three. A program that exits nonzero or times out now shows as a failed call in the AgentKit transcript, named by its error, while the agent still receives the output as an ordinary result.
