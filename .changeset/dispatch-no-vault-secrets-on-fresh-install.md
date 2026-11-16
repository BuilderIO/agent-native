---
"@agent-native/dispatch": patch
---

A fresh Dispatch install no longer creates the retired, unused `vault_secrets` table. Databases that already have it keep it untouched, and the Vault keeps its keys in `app_secrets`.
