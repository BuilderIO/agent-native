---
"@agent-native/core": patch
---

Let the agent render the Builder connect card on the first request in local
dev. `connect-builder` is registered in every registry that receives the
browser tools, but its name reached the first-request tool list only through
the hosted-only handoff, so a local `npx` app answered "connect Builder for me"
with no tool and no chip while the composer and setup card still offered
"Connect Builder.io".
