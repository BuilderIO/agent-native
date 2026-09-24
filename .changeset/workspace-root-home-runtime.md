---
"@agent-native/core": patch
---

Keep root-only workspace apps at their root after sign-in. The app runtime now reads its home path from the workspace manifest entry (the same `/` the launcher already links to), so the root auth handoff no longer redirects signed-in visitors to a `/home` route the app never defined.
