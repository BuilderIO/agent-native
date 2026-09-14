---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Give the chat-first rail one owner for active state so exactly one entry ever
reads as active. `activeAppId` alone could not distinguish "no surface resolved
yet" from "a nav surface is active with no app selected", so every app icon kept
its in-color active treatment whenever Search Chats, Scheduled, Integrations, or
New chat owned the main area. Search Chats was worse: it rendered outside the
tablist with hover-only styling and no `ChatFirstPrimaryTab` member, so it could
never show an active state at all.

`ChatFirstPrimaryTab` now includes `search`, `ChatFirstAppsRail` accepts
`activeTab`, and both the rail and the primary navigation derive their
active/inactive presentation from the shared `chatFirstActiveSurface`,
`chatFirstAppIconState`, and `chatFirstNavTabActive` helpers.
