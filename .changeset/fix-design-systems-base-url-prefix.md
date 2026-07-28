---
"@agent-native/core": patch
---

Fix the Builder Design Systems API base URL fallback incorrectly including an `agent-native/` prefix. The real route is registered as `/design-systems/v1/...` with no `agent-native/` prefix, so requests using the fallback base URL (when `BUILDER_DESIGN_SYSTEMS_BASE_URL` is unset) were hitting the wrong path.
