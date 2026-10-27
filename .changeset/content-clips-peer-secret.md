---
"@agent-native/core": patch
---

Add the `clips.contentPeerSecret` server config field (`CONTENT_CLIPS_PEER_SECRET`) and `resolveContentClipsPeerSecret()`: a secret only the Content and Clips deployments hold, for Content's server-to-server requests about Clips in its documents. The resolver returns null while it is unset and throws `AppConfigurationError` when it is shorter than 32 characters or equal to `A2A_SECRET`. `signShortLivedToken` and `verifyShortLivedToken` take an optional `{ signingKey }` that replaces the app's server secret, with no fallback, so a token can be bound to one key.
