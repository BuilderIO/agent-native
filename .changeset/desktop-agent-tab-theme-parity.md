---
"@agent-native/code-agents-ui": patch
---

Make the Agent tab surface theme-aware: light is now the default palette (matching the scaffolded template tokens), with dark applied via the `.dark` class or `prefers-color-scheme`, and fix a sweep of hardcoded dark-only colors in dialogs, selects/dropdowns, credential/approval callouts, and popovers.
