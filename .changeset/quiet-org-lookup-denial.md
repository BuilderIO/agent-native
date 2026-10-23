---
"@agent-native/core": patch
---

Reject unavailable organization scope instead of treating failed membership reads as Personal access during credential resolution, MCP identity setup, or background task creation. Generic credential reads also reject non-transient membership failures before returning a stored Personal credential whose organization priority could not be checked. Preserve the narrow first-boot missing-membership-table exception for action dispatch.

Keep revoked or mismatched delegated organization access a definitive authorization refusal, including MCP authentication and credential lookup wrappers. Resolve generic credentials' organization scope before provider policy checks and report failed policy or role reads as credential-store unavailability with the original cause.
