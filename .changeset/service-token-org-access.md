---
"@agent-native/core": patch
---

Let org service tokens (`svc-<name>@service.<orgId>`) resolve an implicit
`member` role for their own org via `implicitServiceOrgRole`, so templates that
authorize against `org_members` can accept them for org-scoped actions instead
of returning 403. The role is always `member` and requires the request's org id
to independently corroborate the target org, so admin-gated operations —
including minting or revoking further service tokens — stay closed.
