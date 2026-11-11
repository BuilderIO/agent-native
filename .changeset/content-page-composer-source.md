---
"@agent-native/core": patch
---

Prompt boxes can attach a Content page as a reference: `content` is a composer source, and reads go to the Content app. App-relative links a peer app returns now resolve against that app's URL. `composerWebsiteUrlSchema` is exported from `@agent-native/core/shared`.
