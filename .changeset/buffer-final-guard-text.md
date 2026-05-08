---
"@agent-native/core": patch
---

Buffer streamed assistant text until the final-response guard approves it, so rejected answers never flash before the corrective retry. Removes the `clear` event the UI used to swallow.
