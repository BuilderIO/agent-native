---
"@agent-native/toolkit": patch
---

Exclude a composer submission's own pending entry when checking whether a thread already has a turn in progress before announcing `agentNative.chatComposerSubmit`. First messages in new chats and follow-up sends after a previous run settles now report `queued: false`, so Dispatch's send-time app route runs while sends queued behind an active run still report `queued: true`.
