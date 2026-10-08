---
"@agent-native/core": patch
---

Allow apps to opt into a fallback permission role for active members with no app-role assignments and an exemption for organization owners/admins. Membership checks remain required; organization permission overrides apply to assigned and fallback roles, while opted-in owners/admins bypass app-permission checks.
