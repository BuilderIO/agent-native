---
"@agent-native/core": patch
---

Correct the documented redirect order for `/_agent-native/open` links in the `external-agents` skill and the external agents docs: a template's `resolveOpenPath` is tried before the `/<view>` fallback.
