---
"@agent-native/core": patch
"@agent-native/skills": patch
---

Fix the shared skills CLI picker so the standalone skills package installs with
its matching core runtime, defaults public skills visibly, asks the Plan storage
mode before client setup, and avoids duplicate Claude Code client choices.
The hosted Plans option now also calls out that it is 100% free and open
source.
