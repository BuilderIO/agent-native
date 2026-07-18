---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

BREAKING: move the portable composer, rich editor, collaboration display, visual controls, and shared UI primitives to focused Toolkit entrypoints. Core's removed deep compatibility paths now throw an actionable migration error, and moved symbols are removed from the legacy `@agent-native/core/client` barrel. Run `npx @agent-native/core@latest upgrade --codemods --yes` to rewrite supported imports. Framework-wired composer APIs remain available from `@agent-native/core/client/composer`; bare reusable composer UI is available from `@agent-native/toolkit/composer`.
