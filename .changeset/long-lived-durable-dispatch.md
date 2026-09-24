---
"@agent-native/core": patch
---

Honor an explicit `AGENT_CHAT_DURABLE_BACKGROUND=true` (with `A2A_SECRET`) on long-lived Node servers that carry no hosted-platform marker, and add `AGENT_NATIVE_SELF_DISPATCH_URL` so a deployment can send its self-dispatches over loopback instead of through its public edge.
