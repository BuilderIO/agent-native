---
"@agent-native/core": patch
---

Add personal integration grants. `beginUserIntegrationGrant`, `completeUserIntegrationGrant`, `getUserIntegrationGrant`, `resolveUserIntegrationGrant` and `revokeUserIntegrationGrant` store one user's own provider authorization in the new `integration_user_grants` table, keyed to the signed-in account and active organization. The token bundle lives only in the encrypted vault, each new authorization starts a new generation so a stale callback cannot overwrite a newer one, and another user's grant reads as absent. Identity re-keying now covers the table's owner column.
