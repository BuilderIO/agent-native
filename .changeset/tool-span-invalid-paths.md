---
"@agent-native/core": patch
---

Tool calls rejected for invalid arguments now record which argument fields failed, as paths without values, in the generation's tool entries and the per-tool `$ai_span` event. `$ai_span` also carries `error_class` and `outcome`.
