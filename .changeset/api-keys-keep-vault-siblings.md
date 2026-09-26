---
"@agent-native/core": patch
---

Deleting a provider key from Settings › API keys no longer removes a Vault-synced or managed endpoint or older key name saved beside it, so the provider keeps working until Vault syncs again.
