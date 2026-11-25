---
"@agent-native/toolkit": patch
---

Add a headless app shell. `@agent-native/toolkit/app-shell/sidebar-shell` describes an app's frame and sidebar as a `ShellModel` (regions, navigation entries, effects, bindings, shortcuts and read states), draws it with toolkit's house frames or a part set's `sidebar` and `app-shell` whole parts, shares the collapse, resize, peek, rename, reorder, history and shortcut behaviour across frames, and compares two renderings with `captureShellSnapshot` and `compareShellSnapshots`.
