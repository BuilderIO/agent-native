---
"@agent-native/core": patch
---

Fix Google sign-in on mobile web dropping the post-login return URL. The OAuth
callback's mobile branch attempts the `agentnative://oauth-complete` deep link
(for the native app) but previously hardcoded its fallback to the app root, so
a signed-out visitor who opened e.g. a `/recaps/:id` link in a phone browser
got bounced to the homepage after authenticating instead of back to the page
they came from. The fallback now returns to the validated `returnUrl`; the
native-app deep link is unchanged.
