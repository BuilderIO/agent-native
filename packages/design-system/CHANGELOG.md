# @agent-native/design-system

## 0.235.1

### Patch Changes

- Release all public npm packages with a patch version bump.
- d70dc40: Switch workspace and `agent-native typecheck` CLI typechecking to native `tsgo` when available, falling back to `tsc`.

## 0.235.0

### Patch Changes

- 8959acb: Add the headless model for part sets. `@agent-native/design-system/model` describes a surface as rows with stable dotted ids, validates them against `MODEL_PARTS` (version 1 of the shared part vocabulary), defines the row attributes every part writes (`data-rid`, `data-part`, `data-rid-*`), captures rendered rows (names and state read from ARIA), and compares two renders structurally; it also maps a source rendering without row ids onto the model by selector and compares painted styles row by row. Toolkit's design system takes a `parts` part set, `ModelSurface` draws a model with it (toolkit's parts when the app names no part set; a part set that leaves out a part throws, as do an unhandled effect and an unfilled slot), and `checkPartSetEquivalence` checks one part set against another. A part set can also draw whole surfaces through `whole` (`settings` first), which `SettingsSections` uses when no renderer is provided.
- Release all public npm packages with a patch version bump.

## 0.234.0

### Minor Changes

- dd1218f: Expose Switch styling inputs in the parts catalog and the Components token collection. Existing switch appearances keep their defaults.

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.233.0

### Minor Changes

- a57a58f: Add Image Card parts and edge-to-edge Dialog media and body slots. Compose both in the feature announcement recipe. Video playback controls stay reachable when a card has a full-card link. Long dialog titles wrap clear of the close button in either reading direction.
- a57a58f: Add focused stylesheet imports for Button, Icon Button, Dialog, Autocomplete, and Combobox. Each includes the styles for its built-in parts.
- a57a58f: Add a composable layer tree with keyboard navigation, selection, renaming, visibility, locking and subtree reordering. Set a viewport height to render large expanded trees with a bounded number of rows while preserving selection, focus, and keyboard navigation. Keep focus inside the tree when a document update removes the focused row, and navigate visible rows by typing their names. Horizontal arrow keys follow the reading direction. Drag previews check the selection and target without rebuilding the document order.
- a57a58f: Compose editable inspector sections, labeled property rows, transparency-aware paint swatches, and custom slider tracks and thumbs. Edit single or mixed frame dimensions with preview, commit, and cancel events. Compose token-bound solid and gradient fills, override inspector geometry, and keep overlays inside a scoped theme. Mixed flip selections expose their state to assistive technology and share the mixed-state indicator used by the aspect-ratio lock. Controlled number fields retain pointer movement when focus enters the scrub field. Inspector dimensions support one-pixel adjustments. Selection property updates and code previews retain the application’s geometry type. Compose axis constraints inline or in a compact picker, with keyboard-operable physical edge pins and independent mixed values. Set an accessible name on Select to label both its trigger and its portaled listbox. Alignment and grid size pickers support spatial keyboard navigation in right-to-left layouts. Paint fields support canceling numeric previews and interrupted stop drags, and gradient tracks follow the theme’s reading direction. Matching fills can be edited across layers while preserving each layer’s fill and gradient stop IDs.
- a57a58f: Compose editor workspaces with token-based stack, inline, and grid layouts and resizable panes with pointer and keyboard controls.

  Reuse the Design File panel and property inspector independently or together in the editor workspace.

  Arrange workspace tabs into persistent, resizable groups with pointer, touch, or keyboard docking.

### Patch Changes

- a57a58f: Keep loading button content mounted, preserve keyboard focus in interactive input slots, and render switch states distinctly in forced colors. App shell drawers and collapsed navigation tooltips inherit their overlay scope.
- Release all public npm packages with a patch version bump.
- a57a58f: Associate menu group labels with their command or radio group in menus, context menus and menubars. Menu transitions follow the popup lifecycle. Directional popups enter from their trigger side in right-to-left layouts.
- a57a58f: Add a scoped ThemeProvider for appearance, app theme, density, radius, corners and registered palettes. Dialogs and other overlays inherit the theme of their nearest provider. Native form controls and scrollbars follow the nearest explicit light or dark appearance. Explicit left-to-right and right-to-left regions align keyboard navigation with their layout. Reduce WebKit style recalculation during continuous resizing when multiple app themes are loaded.

## 0.232.0

### Minor Changes

- d4e0116: Add `@agent-native/design-system`: primitive and semantic tokens in W3C design token files that round-trip through Figma, an app theme per template, the type scale (10, 12 and 13px UI steps on 16px lines) and named text styles (`body`, `label`, `title`) as tokens, CSS, `type-*` utilities and a Figma text-style export, and a part catalog whose prop definitions generate each component's types, Storybook controls and manifest entry. Toolkit gains the components built on it under `@agent-native/toolkit/ui/base-ui/*` (Base UI with Radix Themes' props: `variant`, `color`, `size` sm and md at 20 and 24px, with md the standard, `radius`, `highContrast`), documented in Storybook. Nothing in toolkit or the apps renders them yet.

### Patch Changes

- Release all public npm packages with a patch version bump.
