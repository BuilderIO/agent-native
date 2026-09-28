---
"@agent-native/core": patch
---

Stop deduping `@tabler/icons-react` in app builds so the toolkit icon catalog resolves the Tabler version it was generated from, instead of failing with `MISSING_EXPORT` when the app installs a newer Tabler that renamed icons.
