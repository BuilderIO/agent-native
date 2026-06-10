---
"@agent-native/core": patch
---

Add missing indexes on the hottest per-second poll queries: application_state (updated_at) and (key, updated_at), settings (updated_at), and org_members LOWER(email)
