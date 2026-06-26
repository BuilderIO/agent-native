---
"@agent-native/core": patch
---

Route the background-worker's awaited milestone diagnostics through a dedicated
(non-pooled) DB connection. The pooled connection becomes unusable right after
the model-resolution block (model_done lands, the next pooled write hangs), so a
dedicated connection lets the post-model_done milestones land and makes the
worker's true freeze point visible in /runs/active.
