---
"@agent-native/core": patch
---

Share one SSE connection across browser tabs via Web Locks leader election: the tab holding the lock opens `/_agent-native/events` and rebroadcasts frames over a BroadcastChannel; other tabs consume from the channel and keep polling as the safety net. Browsers cap HTTP/1.1 at ~6 connections per origin, so per-tab EventSources across several open tabs starved `<video>` elements (readyState 0, never loading) and could even block page loads. Hidden or closing leaders hand the stream to the next tab automatically; environments without Web Locks/BroadcastChannel keep the previous per-tab behavior.
