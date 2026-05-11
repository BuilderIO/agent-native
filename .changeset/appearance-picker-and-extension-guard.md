---
"@agent-native/core": minor
---

Two additions to core:

- **`AppearancePicker` + `change-appearance` action.** New per-user appearance presets (`warm` / `ocean` / `forest` / `rose` / `slate` + the default) that override the base HSL theme tokens. The runtime reads `localStorage["appearance"]` in the inline theme-init script and sets `<html data-appearance="...">` before hydration, so there's no first-paint flash. Exports: `APPEARANCE_PRESETS`, `applyAppearance`, `getStoredAppearance`, `useAppearance`, `AppearanceSync`, `AppearancePicker`. The agent can change the active preset via the new `change-appearance` core sharing action — auto-registered through `mergeCoreSharingActions`, so every template inherits it.
- **`guard-extension-no-public.mjs`.** New CI guard wired into `pnpm guards`. Statically refuses any change that drops `allowPublic: false` / `requireOrgMemberForUserShares: true` from the extension shareable registration, or that introduces a string literal / raw SQL flipping an extension row to `visibility = "public"` outside the framework-level `set-resource-visibility` action. `sharing` skill updated to document the two new registration flags and point at the guard.
