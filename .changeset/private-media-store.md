---
"@agent-native/core": patch
---

Add `@agent-native/core/private-media`, a store for images that must only load for people who can open the resource they sit in. It validates image bytes, keeps them in private blob storage, and leaves the access check to the app.
