---
"@agent-native/toolkit": patch
---

`PromptComposer` and `TiptapComposer` take `voiceChatEnabled`. Set it to `false` and an empty draft keeps Send as the primary button instead of switching to voice chat, while the dictation mic stays.
