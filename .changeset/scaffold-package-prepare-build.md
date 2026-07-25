---
"@agent-native/core": patch
---

Fix scaffolded workspace packages (pinpoint, embedding, creative-context,
scheduling) never building their `dist/` on install, which broke the Slides
deck editor and Design app with unresolved `@agent-native/*` imports.
`scaffoldRequiredPackages()` now adds a `prepare` script alongside each
package's existing `build` script, so pnpm builds it during `pnpm install`.
