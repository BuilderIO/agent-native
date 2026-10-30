---
"@agent-native/core": patch
---

Personal automations now run on the organization's AI provider key when their creator has no key of their own, as the creator's chat does, instead of failing with `missing_credentials`. The org key is the last resort: a personal key, a pre-org key, the deployment's key and the vault key still come first. The run stays personal for everything else, and "Restrict personal API keys" now applies to personal automations as it does to chat. Builder.io credentials are unchanged.
