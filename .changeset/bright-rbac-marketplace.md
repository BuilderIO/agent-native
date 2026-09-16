---
"@agent-native/core": minor
---

Add admin-managed app roles, permission overrides, explainable action access, member offboarding, workspace application access controls, and the labs Connect Apps foundation.

The migration replaces the single-role `app_member_roles` unique index with an
additive role-aware index; the old index is dropped only so one member can hold
multiple declared roles, and no assignment data is removed.
