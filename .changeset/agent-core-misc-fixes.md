---
"@agent-native/core": patch
---

Seed the shared LEARNINGS.md prompt resource from the project-root learnings.md on first boot (and point migrate-learnings at the shared LEARNINGS.md path the prompt actually reads), make the max-output-token ceiling model-aware (128K for Claude flagship and GPT-5.x models, 64K otherwise), and make the default navigate action throw on missing arguments instead of returning an error string.
