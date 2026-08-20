---
"@agent-native/dispatch": patch
---

Drop unused imports from the Dispatch layout, transactional email pages, and MCP
gateway. `eslint/no-unused-vars` is now an oxlint error instead of a warning, so
CI blocks new ones.
