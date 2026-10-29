---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add `registerBuilderBranchProject`, a host hook that names the Builder project a code-change handoff targets, read through the new `resolveBuilderHandoffProjectId`. Realtime channels and Builder status keep the deployment's project. The Send to Builder card now sends the browser tab id so a host can find the open view. Design registers the hook under Builder identity so the Builder agent works on the project of the open design.
