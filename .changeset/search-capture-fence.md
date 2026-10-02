---
"@agent-native/core": patch
---

Raise a search index's target version before its migration installs change capture, so a build still running the previous version stops using the index instead of finishing a rebuild at that version. The migration also leaves capture alone when a newer version holds the index, and rebuilds the index when it finds capture was missing.
