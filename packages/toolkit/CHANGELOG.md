# @agent-native/toolkit

## 0.4.1

### Patch Changes

- e1ad535: Portal dropdown submenu content so nested menus are not clipped by parent menu overflow.

## 0.4.0

### Minor Changes

- 9d8c83c: Ship a `@agent-native/toolkit/styles.css` entrypoint that registers the package's
  compiled components with Tailwind via a self-relative `@source` directive. Apps
  that render toolkit UI should `@import "@agent-native/toolkit/styles.css";` in
  their `app/global.css` (after the core stylesheet).

  Without it, Tailwind never generated classes that appear only inside toolkit
  components -- e.g. the dropdown/popover content's `z-[250]` and enter/exit
  animations -- so those components rendered with no `z-index` (drawing behind app
  panels) and looked broken/invisible even though they were mounted. This mirrors
  how `@agent-native/core` self-registers its client styles.

- 9d8c83c: Add Toolkit provider overrides, collaboration UI, and sharing UI entrypoints while preserving core client compatibility re-exports. The core re-exports are temporary migration shims; the long-term dependency direction is Toolkit composing core runtime APIs, not core permanently owning reusable app-building UI. Future behaviorful kits should be extracted one at a time, with Sharing as the first candidate to validate access checks, action-backed data, and share-link UI together.

## 0.3.0

### Minor Changes

- 277d115: Ship a `@agent-native/toolkit/styles.css` entrypoint that registers the package's
  compiled components with Tailwind via a self-relative `@source` directive. Apps
  that render toolkit UI should `@import "@agent-native/toolkit/styles.css";` in
  their `app/global.css` (after the core stylesheet).

  Without it, Tailwind never generated classes that appear only inside toolkit
  components — e.g. the dropdown/popover content's `z-[250]` and enter/exit
  animations — so those components rendered with no `z-index` (drawing behind app
  panels) and looked broken/invisible even though they were mounted. This mirrors
  how `@agent-native/core` self-registers its client styles.

## 0.2.0

### Minor Changes

- b24446e: Add `@agent-native/toolkit` for reusable app-building UI, move shared template primitives into it, and keep core UI shim imports working through compatibility re-exports.
