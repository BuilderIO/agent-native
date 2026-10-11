---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

`sendToAgentChat({ submit: false, context })` can name its prefill chip with the new `contextLabel` option; without it the chip uses the generic app-context label. A prefill the composer cannot hold alongside its current context is refused with a `context-too-large` result before the draft changes. A replacement prefill is no longer removed by the cleanup of an earlier send that was still in flight.
