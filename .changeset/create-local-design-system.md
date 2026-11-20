---
"@agent-native/core": patch
---

`agent-native create` with `AGENT_NATIVE_CREATE_USE_LOCAL_CORE=1` now packs the local `@agent-native/design-system` along with toolkit and agentkit, so a generated app installs the workspace's design system instead of the published one.
