---
"@agent-native/core": patch
---

Fix `agent-native doctor` so mixed-subpath imports report each symbol's actual Toolkit destination and the migration guide. Rewrite literal dynamic imports for whole-module moves. The [Core UI upgrade guide](https://github.com/BuilderIO/agent-native/blob/main/packages/core/docs/content/upgrading-core-ui.mdx) documents the codemod workflow.
