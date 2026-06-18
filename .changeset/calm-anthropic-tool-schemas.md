---
"@agent-native/core": patch
"@agent-native/shared-app-config": patch
---

Remove top-level JSON Schema combinators from Anthropic tool input schemas before sending requests so strict provider validation does not reject valid framework tools.

Also mark the Assets template as requiring the embedding package so generated workspaces can resolve `@agent-native/embedding/bridge` during deploy builds.
