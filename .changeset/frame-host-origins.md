---
"@agent-native/core": patch
---

An embedded app now accepts the `agentNative.frameOrigin` handshake only from its own origin, Builder, first-party agent-native hosts, the MCP hosts that frame apps, loopback hosts during local development, and the origins listed in `CORS_ALLOWED_ORIGINS` or the app and workspace URLs. Any other parent, including an opaque sandbox, is accepted only while the app runs on an embed session that the server resolves.
