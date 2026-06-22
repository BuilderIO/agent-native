---
"@agent-native/core": patch
---

Allow `pnpm action <name> '{"arg":"value"}'` to pass a positional JSON object
to defineAction and package actions while preserving existing flag arguments.
