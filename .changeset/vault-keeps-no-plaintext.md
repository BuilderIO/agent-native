---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Dispatch no longer keeps a plaintext copy of vault keys. A saved key is written only as the encrypted `app_secrets` row and `vault_secrets.value` stays empty; the masked preview is read from the encrypted copy. The `sync-vault-to-app` action and the "Sync" buttons are removed, since apps read vault keys from the credential store. `vault_secrets` is now refused by the agent SQL tools and extension SQL, and the new `guard:no-unsealed-secret-columns` flags a new secret-named column that is not marked sealed.
