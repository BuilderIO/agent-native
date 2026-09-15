---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Support multiple app roles per organization member, invitation role pre-assignment, and organization-admin-editable app permission mappings.

The additive migration drops only the prior unique index on `(org_id, app_id, LOWER(email))` and replaces it with one including `role`; it does not change or delete assignment rows.
