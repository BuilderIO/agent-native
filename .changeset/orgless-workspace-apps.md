---
"@agent-native/dispatch": patch
---

Require an organization on the request before creating or materializing a workspace app record, so `workspace_apps` rows are no longer inserted with a null `org_id`. Orgless listing stays read-only, and existing null-org rows are left untouched.
