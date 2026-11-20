---
"@agent-native/core": patch
---

Keep the error code and its fixed message on a saved private error event when the code is private-safe, so a reloaded chat shows "Check what was saved before sending the request again" instead of "Private content omitted".
