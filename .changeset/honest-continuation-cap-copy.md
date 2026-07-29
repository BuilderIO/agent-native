---
"@agent-native/core": patch
---

Fix the chat client telling users "the agent connection kept failing" when a
turn was actually stopped by `MAX_TOTAL_TRANSIENT_CONTINUATIONS`, the
whole-turn ceiling on client re-POSTs of `auto_continue`. That cap only ever
binds turns that were making real progress the whole time, so blaming a
connection failure named the wrong cause. It now reports its own message:
the turn hit the limit on how many times it could be automatically
continued, and suggests retrying as a single, narrower request.
