---
"@agent-native/core": patch
---

Resolve the request-owned database pool when Better Auth scopes pooled transactions so nested database layers detect one-connection self-deadlocks consistently.
