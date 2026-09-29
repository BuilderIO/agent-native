---
"@agent-native/core": patch
---

Owners and admins can invite members when email isn't configured. The invite dialog says invites won't be emailed, and the confirmation says the invite was saved unless the server reports the email went out. `canInviteOrgMembers(role)` now checks only the role; drop any second `emailConfigured` argument.
