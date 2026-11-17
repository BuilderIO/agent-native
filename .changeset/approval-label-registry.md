---
"@agent-native/core": patch
---

An action's `approvalLabel` now survives the action registry, so the approval card asks its question ("Make 5 recordings public?") in apps that load actions from a built registry or mount the core sharing actions, instead of the generic "Approve this tool call?".
