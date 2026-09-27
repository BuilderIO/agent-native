---
"@agent-native/core": patch
---

Return the JSON error from framework routes that fail after reading the request body instead of leaving the client waiting, and stop voice transcription from cancelling its provider call once the audio upload has been read.
