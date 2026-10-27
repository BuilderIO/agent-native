---
"@agent-native/core": patch
---

A reopened chat keeps each reply's "Worked for" row when the saved reply's text differs from what streamed. The saved reply now replaces the streamed copy under the id the run's events use. Before, it came back under its server id (`server-run-…`), so its row vanished. If the saved reply also had a reasoning part, both copies rendered back to back.
