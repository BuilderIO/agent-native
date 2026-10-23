---
"@agent-native/core": patch
---

Reject unavailable organization scope instead of treating failed membership reads as Personal access during credential resolution, MCP identity setup, or background task creation. Generic credential reads also reject non-transient membership failures before returning a stored Personal credential whose organization priority could not be checked. Preserve the narrow first-boot missing-membership-table exception for action dispatch.
