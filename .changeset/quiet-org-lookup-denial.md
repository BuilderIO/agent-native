---
"@agent-native/core": patch
---

Reject unavailable organization scope instead of treating failed membership reads as Personal access during credential resolution, MCP identity setup, or background task creation. Generic credential reads also reject non-transient membership failures before returning a stored Personal credential whose organization priority could not be checked. Preserve the narrow first-boot missing-membership-table exception for action dispatch.

Keep revoked or mismatched delegated organization access a definitive authorization refusal, including MCP authentication and credential lookup wrappers. Resolve generic credentials' organization scope before provider policy checks and report failed policy or role reads as credential-store unavailability with the original cause.

Keep failed non-transient credential lookups distinct from missing credentials in the secret and secret-pair wrappers, preserving the original failure. Propagate unavailable membership reads through event-based organization resolution and session backfill for ordinary and delegated requests instead of returning Personal scope. Keep authorization error classification independent of sharing database initialization.

Keep the engine catalog available when current-engine discovery cannot read a provider credential, reporting an unavailable current selection with its error alongside per-provider diagnostics. Runtime engine detection and definitive authorization refusals still reject.

Record a scoped failed background automation attempt when creator-membership or organization-admin alert lookup is unreadable. Preserve the typed failure and original cause, stop before credential or agent execution, and keep a proven former creator's same-organization admin fallback.

Preserve session membership failures through core HTTP consumers as retryable unavailability, keeping missing sessions and definitive delegated access refusals distinct. Key-save route wrappers preserve those HTTP failures instead of replacing them with a generic server error. Framework route errors forward declared headers and redact unclassified server failures. Keep recipient lookup failures fatal when recording their failed automation history also fails, preserving both causes while retaining execution during history-only outages.
