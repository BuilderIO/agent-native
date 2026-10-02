---
"@agent-native/core": patch
---

Raise a search index's target version before its migration installs change capture, so a build still running the previous version stops using the index instead of finishing a rebuild at that version.
