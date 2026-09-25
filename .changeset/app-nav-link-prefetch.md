---
"@agent-native/toolkit": minor
---

Add `AppNavLink` (from `@agent-native/toolkit/app-shell`) - a drop-in `NavLink` replacement that defaults `prefetch` to `"intent"`, so route modules load on hover/focus instead of racing Vite's dependency discovery on click.
