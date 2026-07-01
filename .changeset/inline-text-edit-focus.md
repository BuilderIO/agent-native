---
"@agent-native/core": patch
---

Add an optional `focus` flag to `setAgentChatContextItem` (and thread it through to the composer). Callers that mirror ambient UI state into chat context — such as a design canvas element selection — can now pass `focus: false` to stage the context chip without moving keyboard focus into the composer. This stops passive context staging from blurring and tearing down an in-progress inline text editor in the Design canvas (which re-fires on every selection and on each get-design poll during an agent run). Focus stays enabled by default, so existing callers are unchanged.
