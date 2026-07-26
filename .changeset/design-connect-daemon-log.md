---
"@agent-native/core": patch
---

`design connect --daemon` now writes the detached bridge's output to
`.agent-native/design-connect.log` and prints that path. Previously the daemon
ran with stdio ignored, so a bridge that crashed or lost its port left no trace
and Design silently fell back to non-editable iframes.
