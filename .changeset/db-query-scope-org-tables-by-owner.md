---
"@agent-native/core": patch
---

The agent's raw database tools now scope a table that has `org_id` and no `owner_email` by its `owner` or `user_id` column, and hide it when it has neither, unless it is on a short list of org-shared tables (`app_permission_overrides`). Before, such a table was readable and writable by every member of the organization, so one member's agent could see another member's rows. An app that keeps its own org-wide table with `org_id` and no owner column can no longer query it through `db-query`, `db-exec` or `db-patch`; give it an `owner_email` column or read it through an action.
