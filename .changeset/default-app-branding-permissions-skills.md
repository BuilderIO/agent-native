---
"@agent-native/core": patch
---

Add `app-branding` and `app-permissions` to the default framework skill set. `app-branding` is layout-aware — it handles both the centralized `app/lib/app-config.ts` source-of-truth layout and the inlined layout where the name/title live across `package.json`, route `meta()`, and `app/root.tsx`. Generated apps using `frameworkSkills: "default"` now receive both skills on scaffold and `skills update`.
