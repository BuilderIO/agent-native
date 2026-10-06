---
"@agent-native/core": patch
---

Agent-readable links are shorter. Scoped agent-access tokens (`signScopedAgentAccessToken`, `createScopedAgentAccessGrant`) now use a compact format that no longer embeds the resource id in the payload; the signature covers it instead. A Slides deck link drops from about 290 to about 205 characters and a password-protected Clips link from about 360 to about 185, so both fit under the 250-character URL limit of Anthropic's web fetch tool. `viewerEmail`, `agentLabel`, and the expiry are still signed into the token. `verifyScopedAgentAccessToken` accepts both formats, so links minted before the upgrade keep working until they expire. Failures for a token minted for a different resource now report `bad_signature` instead of `wrong_resource`. `signShortLivedToken` and `verifyShortLivedToken` are unchanged.
