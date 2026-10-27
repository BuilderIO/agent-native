---
"@agent-native/agentkit": patch
"@agent-native/creative-context": patch
"@agent-native/dispatch": patch
"@agent-native/otel": patch
"@agent-native/pinpoint": patch
"@agent-native/recap-cli": patch
"@agent-native/scheduling": patch
"@agent-native/skills": patch
"@agent-native/toolkit": patch
---

Compile with `noImplicitOverride` and `noFallthroughCasesInSwitch`, and, where the code already passes them, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Optional fields that legitimately hold `undefined` are now typed `T | undefined`. No runtime behavior changes.
