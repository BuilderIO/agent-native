---
"@agent-native/core": patch
---

Keep credentials saved before an organization existed reachable afterwards.
A key saved while a user had no org is stored at `workspace` scope under
`solo:<email>`. Once that user joined or created an org, the generic lookups
stopped at org scope, so the key was still in the vault but the app reported it
as not configured. `resolveCredential` and `resolveSecret` now probe the solo
workspace scope as the final step, matching what the Builder credential paths
already did.

The probe is last on purpose: user scope, org scope, the org's workspace row,
and the org-scoped legacy setting are all tried first, so a current org-scoped
key always wins over a stale pre-org one. It also stays behind the existing
store-readability check — a failed org-scoped read is still reported as
retryable rather than being answered from the pre-org row.
