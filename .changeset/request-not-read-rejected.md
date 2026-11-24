---
"@agent-native/core": patch
---

A request the provider read none of (`request_not_read`, usually too many or too complex tool definitions) is now treated as a rejected request: it is not resent, a kept guard draft is shown alone, and the chat explains that the request was too large or complex. The empty-response error no longer claims the output-token budget was the cause.
