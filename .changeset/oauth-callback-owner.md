---
"@agent-native/core": patch
---

OAuth state now expires after 30 minutes, and a browser OAuth callback connects the account to the session it arrives with. `oauthCallbackOwner` is exported for app callbacks, and `resolveOAuthOwner` takes the flow's desktop and mobile flags.
