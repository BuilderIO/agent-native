---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Apps in a workspace with no domain can now delegate to each other. When both apps share `A2A_SECRET`, the caller sends the person's own signed identity with no workspace claim, and the peer runs the call in that person's personal scope instead of rejecting an unsigned request. When a peer pauses the delegated task for approval, the chat shows a card that opens the peer's approval page, then continues the same task once the person approves it there. The card stays in the chat after a reload and closes once that task finishes.
