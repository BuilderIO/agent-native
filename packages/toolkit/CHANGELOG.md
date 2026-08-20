# @agent-native/toolkit

Older releases are archived in [changelog/archive/CHANGELOG.md](./changelog/archive/CHANGELOG.md).

## 0.16.8

### Patch Changes

- 60b7e74: Pin Tiptap bubble-menu and floating-menu to 3.30.1 so npm no longer warns on optional peer mismatches when installing the CLI.

## 0.16.7

### Patch Changes

- fc85cb2: Allow external prompt handoffs to insert text through the shared composer without publishing a runtime message update.

## 0.16.6

### Patch Changes

- a2f21dc: Fix `ActionButton` and `IconButton` (from `@agent-native/toolkit/design-system`) not forwarding a native `ref`, which broke every Radix `asChild` trigger built on them — popovers, tooltips, dropdown menus, and dialogs positioned relative to the button would render off-screen (`transform: translate(0px, -200%)`) because Radix's `Slot` had no DOM node to measure. `ActionButton`/`IconButton` are now wrapped in `forwardRef`, and the forwarded ref is merged with the existing `elementRef` prop so both resolve to the same DOM node — existing consumers that pass `elementRef` explicitly are unaffected.

  Also fix `IconButton` dropping a native `onClick`. `IconButtonProps` did not
  declare `onClick` and the default adapter spread incoming props before setting
  its own handler, so a Radix `asChild` trigger built on `IconButton` — popover,
  dropdown menu, dialog — never opened at all. `IconButton` now merges `onClick`
  with `onPress` the same way `ActionButton` already did.

## 0.16.5

### Patch Changes

- 0b57293: Fix `ActionButton` and `IconButton` (from `@agent-native/toolkit/design-system`) not forwarding a native `ref`, which broke every Radix `asChild` trigger built on them — popovers, tooltips, dropdown menus, and dialogs positioned relative to the button would render off-screen (`transform: translate(0px, -200%)`) because Radix's `Slot` had no DOM node to measure. `ActionButton`/`IconButton` are now wrapped in `forwardRef`, and the forwarded ref is merged with the existing `elementRef` prop so both resolve to the same DOM node — existing consumers that pass `elementRef` explicitly are unaffected.

  Also fix `IconButton` dropping a native `onClick`. `IconButtonProps` did not
  declare `onClick` and the default adapter spread incoming props before setting
  its own handler, so a Radix `asChild` trigger built on `IconButton` — popover,
  dropdown menu, dialog — never opened at all. `IconButton` now merges `onClick`
  with `onPress` the same way `ActionButton` already did.

## 0.16.4

### Patch Changes

- 95ea873: Allow editor-owned controls outside TipTap's contenteditable surface to protect active edits from stale collaboration snapshots, and preserve a valid selection when collaborative documents initially hydrate block-only nodes.
