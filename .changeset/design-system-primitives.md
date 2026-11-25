---
"@agent-native/toolkit": patch
---

Let a design system replace Base UI primitives by name. `defineDesignSystem({ primitives })` takes replacements that receive exactly the replaced primitive's props, ref included; the Button family (`Button`, `ButtonLink`, `IconButton`, `IconButtonLink`) is the first set wrapped with `swappable`.
