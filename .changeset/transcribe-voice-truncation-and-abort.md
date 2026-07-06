---
"@agent-native/core": patch
---

transcribe-voice reliability: raise the dictation-cleanup text cap from 40k to 150k chars, truncate the middle (with a visible marker and a server-side warning) instead of silently dropping the tail when the cap is still exceeded, and abort in-flight provider fetches (Whisper-compatible, Gemini, Builder cleanup, chat-provider cleanup) when the client disconnects mid-request so abandoned dictation attempts stop burning provider time.
