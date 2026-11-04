---
"@agent-native/core": patch
---

Docs, the workspace note `create` prints, and the agent's scaffolding hint now say `pnpm exec agent-native add-app` instead of `npx @agent-native/core@latest add-app`, so adding an app runs the workspace's installed CLI instead of downloading the latest Core each time.
