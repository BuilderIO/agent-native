---
"@agent-native/agentkit": patch
"@agent-native/core": patch
"@agent-native/creative-context": patch
"@agent-native/design-system": patch
"@agent-native/dispatch": patch
"@agent-native/otel": patch
"@agent-native/pinpoint": patch
"@agent-native/recap-cli": patch
"@agent-native/scheduling": patch
"@agent-native/skills": patch
"@agent-native/toolkit": patch
---

Switch workspace and `agent-native typecheck` CLI typechecking to native `tsgo` when available, falling back to `tsc`.
