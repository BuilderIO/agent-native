---
"@agent-native/core": patch
---

Enable TypeScript strict mode across the framework monorepo. All template packages and core now compile with `"strict": true`, fixing implicit-any parameters, strict null checks, and function type contravariance throughout.
