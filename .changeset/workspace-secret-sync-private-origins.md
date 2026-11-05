---
"@agent-native/core": patch
---

Allow organization A2A secret sync to configured loopback workspace gateways without following redirects or syncing to the sender. Fail sync when workspace manifests or recipient URLs are unreadable instead of silently omitting apps, while ignoring non-app folders.
