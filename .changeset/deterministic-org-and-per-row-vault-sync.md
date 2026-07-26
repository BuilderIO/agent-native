---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Fix two independent defects behind intermittent `Missing <KEY>` errors for
multi-org users.

Membership resolution now asks the database for a deterministic order
(`ORDER BY joined_at ASC, org_id ASC`), so the oldest membership wins. The three
fallback paths in `org/context.ts` — `getOrgContext`, `resolveOrgIdForEmail`, and
`resolveOrgIdForEmailViaEvent` — previously read the first row of an unordered
`SELECT`. On Postgres that order is a query-plan and physical-layout detail, so
any multi-org user without a valid persisted `active-org-id` got an arbitrary
answer that could change between two identical requests, and `getSession` then
froze it into `session.orgId`. This does not repair users who already have the
wrong org persisted in `active-org-id`; that needs a separate data change.

`syncGrantsToApp` now writes each vault secret under the org that owns the row
instead of the org of whoever clicked Sync. In `all-apps` mode it lists secrets
across every org the caller can see, then synced them all with the caller's ctx,
which `credentialStoreScopeForVaultCtx` turned into `scope: "org"` +
`scopeId: <caller org>`. Because `writeAppSecret` upserts, that copied rather
than moved, so credential material accumulated in whichever orgs happened to be
active during a sync. Grouping by the row's own tenant matches what every other
sync path already did via `ctxForSecretRow`. The sync result and audit entry now
report `credentialStores` (one entry per tenant written) in place of the single
`credentialStore` object.
