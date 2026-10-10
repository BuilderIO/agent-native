---
"@agent-native/core": patch
---

Create indexes for the sharing access filters (lower(owner_email) and share principals) in the release migration, so list and access checks on owned tables stop scanning every share row.
