---
"@agent-native/core": patch
---

Sync the headless scaffold's `agent-native-docs` skill with the canonical copy (restores the packaged source-corpus guidance and `source-search` usage it had missed), and extend the workspace-skills sync guard to cover `packages/core/src/templates/headless/.agents/skills` so it can no longer drift silently.
