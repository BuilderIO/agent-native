---
"@agent-native/dispatch": patch
---

Drop unused imports from the Dispatch layout, transactional email pages, and MCP
gateway. `pnpm guard:no-unused-imports` now fails the build on new ones, and
`pnpm fix:unused-imports` removes them.
