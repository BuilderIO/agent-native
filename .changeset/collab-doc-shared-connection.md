---
"@agent-native/core": patch
---

Collaborative docs now share one connection per document per tab (ref-counted registry), eliminating duplicate poll/state/awareness traffic when multiple components mount the same doc.
