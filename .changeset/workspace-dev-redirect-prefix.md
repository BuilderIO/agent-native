---
"@agent-native/core": patch
---

Fix workspace dev gateway losing the app prefix on root-relative redirects (e.g. Google OAuth flows). Path-only redirect `Location` headers are now rewritten to include the `/{app.id}` mount prefix, matching the repo `dev-lazy` gateway.
