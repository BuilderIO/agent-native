---
"@agent-native/core": patch
---

`verifyScopedAgentAccessToken` no longer accepts scoped agent-access tokens minted in the older format that embedded the resource id in the payload. Links and approval emails minted before the compact format shipped (7 days at most) stop verifying, and the caller sees a normal failed verification. `signShortLivedToken` and `verifyShortLivedToken` are unchanged.
