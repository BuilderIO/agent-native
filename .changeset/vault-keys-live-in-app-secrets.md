---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

The Dispatch Vault now stores its keys only in `app_secrets` and no longer reads or writes `vault_secrets`. `app_secrets` gains nullable `label`, `provider` and `created_by` columns, and a key's id is its `app_secrets` row id. The Vault page lists the organization's keys (or your own solo workspace's), a key created or edited in the Vault is marked with `created_by`, and a rename moves the stored ciphertext with the row. `vault_grants` gains a nullable `credential_key`, which core's manual-mode check now reads instead of joining `vault_secrets`; grants from before this release grant nothing until `credential_key` is backfilled. The table stays in existing databases, untouched, until it is dropped. The new `guard:no-vault-secrets-table` fails when source reads or writes it.
