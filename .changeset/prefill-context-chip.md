---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

`sendToAgentChat({ submit: false, context })` no longer writes the raw `<context>` block into the composer draft. The context attaches to the next submit instead, shown as a chip labeled by the new `contextLabel` option. Without `contextLabel` it attaches with no chip, unless the message is empty, which gets a generic chip. Unlabeled context stays with its composer and is kept with the draft; it is never shared with other open chats.
