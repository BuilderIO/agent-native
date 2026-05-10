---
"@agent-native/core": patch
---

Wrap SSR loaders in `runWithRequestContext` so React Router loaders see the signed-in user via `getRequestUserEmail()` / `accessFilter()`. Fixes a bug where the slides "Presentation link" 404'd for shared admins and even for the deck owner unless visibility was made public.
