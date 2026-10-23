---
"@agent-native/core": patch
---

Reject unavailable organization scope instead of treating failed membership reads as Personal access during credential resolution, MCP identity setup, or background task creation. Preserve the narrow first-boot missing-membership-table exception for action dispatch.
