---
"@agent-native/core": patch
---

Add `registerBuilderBranchProject`, a host hook that names the Builder project a code-change handoff should target. When set, it is consulted before the Dispatch, env and secret lookups; Design registers it under Builder identity so the Builder agent works on the project of the open design.
