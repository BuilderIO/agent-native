---
"@agent-native/core": patch
---

Fix the hosted tools-only harness being silently unavailable in production for apps that only set `harness` in `agent-native.config.ts` (Chat, Mail, Analytics, Calendar). `loadHostedHarnessConfig` read that file from disk at request time, but a deployed serverless function never ships `agent-native.config.ts`/`agent-native.json`, so the read resolved to "not configured" instead of the app's actual setting. The setting is now resolved once at build time from the same app config the client bundle uses and embedded into the server bundle; the disk read remains as a fallback for dev servers and `agent-native start`, where the config file is actually present.
