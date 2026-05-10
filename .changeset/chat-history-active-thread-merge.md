---
"@agent-native/core": patch
---

Stop chat history from "reverting" mid-conversation: `useChatThreads.fetchThreads` now reconciles per-thread instead of replacing wholesale, so a server fetch that arrives a few hundred ms behind a fresh local update no longer rolls the recent-chats list back to older timestamps. The active thread is also kept visible in the History popover (and highlighted as `Active`) even when its `messageCount` is still zero, so a brand-new chat doesn't appear to vanish from the list right after opening.
