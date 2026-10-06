---
"@agent-native/dispatch": patch
---

Fix the thread debug inspector: folded run ids no longer appear as duplicate standalone rows, a deep-linked run outside the most recent window is fetched explicitly instead of silently showing the latest run, and thread-scoped traces (no run id) are now visible in the Thread tab.
