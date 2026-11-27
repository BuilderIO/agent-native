---
"@agent-native/core": patch
---

Run a cross-app A2A call that carries no workspace claim in the workspace the person sees in the receiving app (saved choice, else first membership), so a person in several workspaces no longer gets "no LLM provider is connected" from a peer whose provider is configured. The missing-provider message now deep links to the peer's LLM settings.
