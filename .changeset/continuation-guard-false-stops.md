---
"@agent-native/core": patch
---

Stop the chat continuation guards from ending turns that were still working: an explicit `recoverable: false` on an error event now outranks the transient message sniff (a repeat-guard stop naming a `*connection*` tool auto-continued the loop it was meant to break), `loop_limit` work boundaries are bounded by their own ceiling instead of the transient-failure one, and the stall signal is read from each round's delta so an unresolved "Preparing" card cannot make later rounds look stuck. History trimming also prices object tool results by what the request actually sends instead of `[object Object]`.
