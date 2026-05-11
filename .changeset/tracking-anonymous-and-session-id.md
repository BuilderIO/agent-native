---
"@agent-native/core": minor
---

Browser tracking now sends a persistent `anonymousId` (visitor ID) and a `sessionId` with a 30-minute idle timeout on every event posted to the Agent Native Analytics `/track` endpoint. Both IDs are stored in `localStorage` and degrade gracefully to NULL when storage is unavailable (private browsing). Unique-visitor and session metrics in the analytics template now have real data to aggregate against; previously these columns were always NULL for anonymous traffic.
