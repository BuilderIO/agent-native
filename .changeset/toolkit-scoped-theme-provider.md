---
"@agent-native/toolkit": minor
"@agent-native/design-system": patch
---

Add a scoped ThemeProvider for appearance, app theme, density, radius, corners and registered palettes. Dialogs and other overlays inherit the theme of their nearest provider. Native form controls and scrollbars follow the nearest explicit light or dark appearance. Explicit left-to-right and right-to-left regions align keyboard navigation with their layout. Reduce WebKit style recalculation during continuous resizing when multiple app themes are loaded.
