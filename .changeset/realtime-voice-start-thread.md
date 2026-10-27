---
"@agent-native/toolkit": patch
---

Let a page hand a voice chat off to a chat thread:

- `useRealtimeVoiceMode().start({ threadId })` binds the session's transcripts to that thread instead of the thread on screen when the session starts.
- `AgentKitComposer`, `PromptComposer`, and `TiptapComposer` accept `onVoiceChatStart`, which replaces the default start when the empty Send slot starts voice chat.
