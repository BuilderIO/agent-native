---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Support multiple app roles per organization member, invitation role pre-assignment, and organization-admin-editable app permission mappings.

The additive migration drops only the prior unique index on `(org_id, app_id, LOWER(email))` and replaces it with one including `role`; it does not change or delete assignment rows.

The new array-based client fields are additive for this minor release: `role`, `myRole`, and the deprecated `useSetAppMemberRole` adapter remain available while callers migrate to `roles`, `myRoles`, and `useSetAppMemberRoles`.
