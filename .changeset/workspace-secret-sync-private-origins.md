---
"@agent-native/core": patch
---

Allow organization A2A secret sync to configured loopback workspace gateways without following redirects or syncing to the sender. Fail sync when workspace manifests or recipient URLs are invalid instead of silently omitting apps, including URLs with query strings or fragments, while ignoring non-app folders.
