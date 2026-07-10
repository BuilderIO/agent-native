---
"@agent-native/core": patch
---

Fix a race where a background chat run silently deferred for sweep-based recovery could hit the client's idle timeout before the server redispatched it, surfacing a false "run stopped" error instead of resuming quietly. Queued follow-ups now reattach to the recovering run instead of colliding with it, and terminal continuation conflicts settle pending activity cards so completed or failed chats never retain a working spinner.
