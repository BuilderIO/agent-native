---
"@agent-native/core": patch
---

A Builder.io sign-in no longer needs re-authorizing after a temporary failure to refresh its access token during a chat turn. Only a refresh Builder rejects outright (a revoked or invalid grant) asks the user to sign in again; a network or server error is retried on the next request.
