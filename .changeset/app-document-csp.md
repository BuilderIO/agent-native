---
"@agent-native/core": patch
---

Add Content-Security-Policy to app document responses: `object-src 'none'; base-uri 'self'` enforced, `script-src` emitted as Report-Only with a Sentry-config hash when configured. Skipped in dev and opt-outable via `AGENT_NATIVE_DISABLE_DOC_CSP=1`.
