---
"@agent-native/core": patch
---

Queued chat messages now run under the model, engine, and reasoning effort they
were composed with instead of whatever the picker happens to be set to when the
queue flushes. Queued bubbles also gain a "Send now" control that interrupts the
active run, and the pending group is labelled with its count.
