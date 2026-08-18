---
"@agent-native/toolkit": patch
---

Fix `ActionButton` and `IconButton` (from `@agent-native/toolkit/design-system`) not forwarding a native `ref`, which broke every Radix `asChild` trigger built on them — popovers, tooltips, dropdown menus, and dialogs positioned relative to the button would render off-screen (`transform: translate(0px, -200%)`) because Radix's `Slot` had no DOM node to measure. `ActionButton`/`IconButton` are now wrapped in `forwardRef`, and the forwarded ref is merged with the existing `elementRef` prop so both resolve to the same DOM node — existing consumers that pass `elementRef` explicitly are unaffected.
