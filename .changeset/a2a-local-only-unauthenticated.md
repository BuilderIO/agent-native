---
"@agent-native/core": patch
---

A2A requires `A2A_SECRET` outside local development. Without a configured secret, the A2A JSON-RPC endpoint and its async task processor accept unauthenticated calls only from the same machine and return 401 to other hosts, including a development server on a public preview URL. The Agent Teams, background chat-run, sandbox execution, integration task and A2A continuation processors apply the same local-only check to unsigned dispatches. Async `message/send` without a secret is refused up front when the processor handoff would leave this machine, instead of returning a task that never starts, and an integration task is marked failed instead of being handed off unsigned to a processor that would refuse it. With a secret configured, a call without a valid token from another host is now refused in development as well as production. Set `A2A_SECRET` on any app that receives A2A calls from another host.
