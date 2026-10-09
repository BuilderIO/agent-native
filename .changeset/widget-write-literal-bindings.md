---
"@agent-native/core": patch
---

Directory widget write grants can now carry the share actions for their own resource, with limits: a widget cannot grant the admin role, share with an organization or group, or put its own note in the share email. Every literal-bound argument of a widget write call must be supplied and equal to its ticketed value. A profile can gate a scoped read behind a write action with `widgetReadActionWriteGates`, so a read-only ticket never lists collaborators. Widget capabilities use a compact encoding (the old encoding still verifies) so a grant with the share actions fits a browser cookie.
