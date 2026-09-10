---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Stop the usage dashboard from reporting zero spend when usage rows carry no organization id. `token_usage.org_id` is filled from the request context, so recurring jobs, automations, and every row written before that column was populated are NULL, and the org-equality read filter hid them from an already owner-scoped query. Usage attributed to a different organization stays excluded.
