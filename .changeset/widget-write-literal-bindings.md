---
"@agent-native/core": patch
---

Directory widget write grants can now carry the share actions for their own resource. Every literal-bound argument of a widget write call must be supplied and equal to its ticketed value, the share actions repeat the grant's resource and action check inside the action, and widget capabilities use a compact encoding (the old encoding still verifies) so a grant with the share actions fits a browser cookie.
