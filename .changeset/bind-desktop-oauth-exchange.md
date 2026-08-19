---
"@agent-native/core": patch
---

Bind desktop Google OAuth exchanges to a high-entropy verifier so a known flow ID alone cannot retrieve a session token.

Previously `/_agent-native/auth/desktop-exchange` returned a live session token to any caller that named the flow ID, and the flow ID came straight from the query string. An attacker could pick an ID, send someone to `/_agent-native/google/auth-url?desktop=1&flow_id=<known>&redirect=1`, then poll the exchange after that person signed in and receive their session token. The verifier now travels in an `X-Agent-Native-Desktop-Verifier` request header — which a link navigation cannot set — only its hash is stored, and the exchange read fails closed when the verifier is missing or does not match.

**Desktop clients must be upgraded.** The old `GET ?desktop=1&flow_id=…` bootstrap is rejected, because that request shape is exactly what made the exchange stealable; there is no backward-compatible variant that keeps the fix. An older independently deployed desktop client will fail Google sign-in with `Invalid desktop exchange challenge.` until it ships the header-based bootstrap.
