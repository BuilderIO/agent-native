---
"@agent-native/core": patch
---

Make the `/_agent-native/agent-engine/status` probe cheap. The route ran four sequential DB/secret hops per request (session, org, `OPENAI_BASE_URL` secret, `agent-engine` setting) plus an unconditional `app_secrets` sweep, which is why the agent panel took seconds to decide whether a provider is configured. The stored-setting and base-URL reads now run concurrently, the `app_secrets` sweep only runs when the cheaper sources have not answered, and concurrent probes of the same user/org share one in-flight lookup. The shared entry is dropped as soon as the lookup settles, so adding or removing a provider is never reported stale and no identity ever sees another's answer.
