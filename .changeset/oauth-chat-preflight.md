---
"@agent-native/core": patch
---

Treat a usable Builder OAuth connection as enough to start chat. The connect flow already saves OAuth tokens, but run preflight still required a legacy private/public key pair, so new hosted workspace apps showed "No LLM provider is connected" after a successful connect.
