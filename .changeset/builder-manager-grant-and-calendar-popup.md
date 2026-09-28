---
"@agent-native/core": patch
---

Owners and admins run on their organization's Builder.io connection first, whether it's an OAuth grant or a key pair, so a personal connection kept from before a promotion no longer shadows it. Their own connection stays the fallback when the organization has none.
