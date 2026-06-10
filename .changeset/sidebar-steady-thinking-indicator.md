---
"@agent-native/core": patch
---

Keep the agent sidebar's running indicator showing a steady "Thinking" while the
model works, instead of flipping through transient framework step labels (e.g.
"Contacting model", "Preparing X action") right after a message is submitted.
The Reconnecting and Resuming connection states are unchanged.
