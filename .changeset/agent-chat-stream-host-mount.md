---
"@agent-native/core": patch
---

Let a host that mounts an app at runtime set the agent-chat streaming URL (`__AGENT_NATIVE_EXTERNAL_EMBED.streamingUrl`), let an app's own config enable the stream route, and fall back to the primary chat route when the streaming origin refuses a turn before running it (401, 403, 404, 405).
