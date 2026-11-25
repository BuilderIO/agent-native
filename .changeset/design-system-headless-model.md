---
"@agent-native/design-system": patch
"@agent-native/toolkit": patch
---

Add the headless model for part sets. `@agent-native/design-system/model` describes a surface as rows with stable dotted ids, validates them against `MODEL_PARTS` (version 1 of the shared part vocabulary), defines the row attributes every part writes (`data-rid`, `data-part`, `data-rid-*`), captures rendered rows (names and state read from ARIA), and compares two renders structurally; it also maps a source rendering without row ids onto the model by selector and compares painted styles row by row. Toolkit's design system takes a `parts` part set, `ModelSurface` draws a model with it (toolkit's parts when the app names no part set; a part set that leaves out a part throws, as do an unhandled effect and an unfilled slot), and `checkPartSetEquivalence` checks one part set against another. A part set can also draw whole surfaces through `whole` (`settings` first), which `SettingsSections` uses when no renderer is provided.
