---
"@agent-native/core": patch
---

Keep photos, documents, voice notes and captions on incoming Telegram messages instead of dropping the message. The agent gets the caption and a reference to the file (name or `file_id`, and type), not the file contents. A Telegram album now gets one agent turn with every file and its caption, instead of one turn per photo. Thread history keeps the file lines of a message, so a photo sent without a caption is no longer saved as an empty message.
