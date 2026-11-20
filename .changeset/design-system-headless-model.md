---
"@agent-native/design-system": patch
"@agent-native/toolkit": patch
---

Add the headless model for part sets. `@agent-native/design-system/model` describes a surface as rows with stable dotted ids, validates them, defines the row attributes every part writes, captures rendered rows (names and state read from ARIA), and compares two renders structurally; it also maps a source rendering without row ids onto the model by selector and compares painted styles row by row. Toolkit's design system takes a `parts` part set, `ModelSurface` draws a model with it (falling back to toolkit's parts, throwing on an unknown part, an unhandled effect or an unfilled slot), and `checkPartSetEquivalence` checks one part set against another.
