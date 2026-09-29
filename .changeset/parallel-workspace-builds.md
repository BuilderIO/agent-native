---
"@agent-native/core": minor
---

Workspace app builds in `agent-native deploy` can run in parallel. Set `deployment.workspace.buildConcurrency` in `agent-native.config.ts` to a number or `"auto"`, or override it with `AGENT_NATIVE_DEPLOY_CONCURRENCY` or `--concurrency <n|auto>`. `"auto"` sizes the pool to the builder's cores and memory (about 4 GB per build, after holding back about 1.5 GB), so an 8 GB builder still builds one app at a time. Builds stay sequential when nothing is set.
