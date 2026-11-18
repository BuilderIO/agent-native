---
"@agent-native/core": patch
---

The agent's raw database tools (`db-query`, `db-exec`, `db-patch`) now scope a table that has `org_id` and no `owner_email` by its `owner` or `user_id` column when it has one. A framework table with `org_id` and no owner column at all is hidden, unless it is on a short list of org-shared framework tables (`app_permission_overrides`). Before, such tables were readable and writable by every member of the organization, so one member's agent could see another member's rows. A table your app defines itself with `org_id` and no owner column keeps the org-wide view it always had.
