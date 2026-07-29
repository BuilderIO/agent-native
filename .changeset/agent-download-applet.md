---
"@agent-native/core": patch
---

The agent now hands over files it creates instead of describing where to find them. A new `offer-download` action resolves a workspace file to an access-scoped download URL and renders it as a compact download card in chat, the resources route supports `?download` for a real save-to-disk response, and a framework rule tells the agent to hand over artifacts rather than give app-navigation directions.
