---
"@agent-native/core": patch
---

Add org-scoped service tokens so CI credentials (e.g. the `PLAN_RECAP_TOKEN` secret used by PR Visual Recap) belong to the organization instead of one person. Previously the token was a personal device-flow bearer keyed to one owner's email — if that person left or revoked their tokens, every repo's recap CI started 401ing, and CI-created plans were owned by an individual.

- `mcp_connect_tokens` gains additive `kind` / `service_name` / `created_by` columns; service tokens authenticate as a synthetic service principal (`svc-<name>@service.<orgId>`) whose resolved session carries the org id, so rows created by CI are org-scoped and visible to org members.
- New core actions: `create-org-service-token` (org owner/admin, token value returned once and never stored), `list-org-service-tokens` (any org member, metadata only), and `revoke-org-service-token` (org owner/admin, same revocation gate as personal tokens).
- New CLI flow: `agent-native connect <url> --service-token <name> [--ttl-days <1-365>]` authenticates the human via the existing device flow, mints the org service token, and prints it once with guidance to store it as the `PLAN_RECAP_TOKEN` secret.
- Personal connect-token behavior is unchanged.
