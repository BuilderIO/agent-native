---
"@agent-native/core": patch
---

Propagate verified direct loopback context across in-process `get-actions-batch` item dispatches so batched GET actions (such as `get-chatgpt-subscription-status` and `list-model-providers`) retain direct loopback access on `http://127.0.0.1`.
