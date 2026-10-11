---
"@agent-native/core": patch
---

Return typed permission errors for organization membership and admin assertions so admin-only actions, including set-app-member-roles and explain-access, return clear 401/403 responses and audited refusals are recorded as denied.

Preserve organization-admin membership lookup failures as internal faults rather than misclassifying them as permission denials.
