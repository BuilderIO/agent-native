---
"@agent-native/toolkit": patch
---

Button press feedback now eases instead of snapping: include the native `scale` property in the Button transition list (Tailwind v4 compiles `active:scale-*` to `scale`, which the previous `transform`-only list didn't animate).
