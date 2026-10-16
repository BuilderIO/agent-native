---
"@agent-native/core": patch
---

Stop a development server connected to a remote database from making stored secrets unreadable for the deployments that share it. It now refuses to write a secret unless the secrets already stored in that scope use its preferred encryption key, and it no longer re-encrypts secrets on read. Reads also log a warning naming the secret when it cannot be decrypted, instead of silently treating it as missing.
