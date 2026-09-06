---
"@agent-native/core": patch
---

Fix org creation and SSO login failing with `value "<epoch ms>" is out of range for type integer` by widening `organizations`, `org_members`, `org_invitations`, `app_member_roles`, `workspace_apps`, `identity_sso_flow_state`, and `identity_sso_jti` millisecond-timestamp columns from `INTEGER` to `BIGINT`. Also corrects the Drizzle schema for these tables plus `chat_threads`, `email_log`, and `app_secrets`, which declared their (already- or now-)BIGINT timestamp columns as `integer(...)` — silently mistyping them as `number` when node-postgres actually decodes `BIGINT` as a string.
