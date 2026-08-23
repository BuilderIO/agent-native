---
"@agent-native/dispatch": patch
---

Automations page now writes the selected automation into a `?automationId=` URL param instead of untracked local state, so a selected row can be linked, reloaded, and reached with browser Back on both `/automations` and `/admin/automations`.
