---
"@agent-native/core": patch
---

A2A requires `A2A_SECRET` outside local development. Without a configured secret, the A2A JSON-RPC endpoint and its async task processor accept unauthenticated calls only from the same machine and return 401 to other hosts, including a development server on a public preview URL. With a secret configured, a call without a valid token from another host is now refused in development as well as production. Set `A2A_SECRET` on any app that receives A2A calls from another host.
