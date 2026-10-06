---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

The sign-in page now records first and last touch with Core's shared capture instead of its own older copy. Visitors who land on a sign-in page keep the marketing site's forwarded referrer and landing page, ad click ids, and last touch, and a later tagged visit replaces an untagged first one. `captureAttribution()` is also available from the lightweight `@agent-native/core/client/attribution` entry, with a `landingPath` option for pages that stand in front of the path the visitor asked for.
