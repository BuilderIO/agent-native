# @agent-native/toolkit

## 0.9.0

### Minor Changes

- 0341a7d: Add an ejectable dashboard presentation kit with cards, tables, date ranges, chart state rendering, and layout helpers.

## 0.8.3

### Patch Changes

- 5c78d2d: Fix cramped calendar day grid under Tailwind v4 and make the date picker responsive: smaller cell size on mobile, 20% smaller on desktop, and a viewport-bounded popover width.

## 0.8.2

### Patch Changes

- dcd0810: Add clear creation actions to empty resource views and improve collaboration usage feedback.

## 0.8.1

### Patch Changes

- 6d96437: Add clear creation actions to empty resource views and improve collaboration usage feedback.

## 0.8.0

### Minor Changes

- 8453025: Publish ejection units for every Toolkit entry point so apps can take ownership of individual presentation features while preserving protected runtime contracts.

## 0.7.0

### Minor Changes

- e53a34e: Move the reusable ChatHistoryList and its stylesheet to the Toolkit chat-history entrypoint while preserving Core compatibility imports. Adopt it across first-party full-page chat sidebars, ship readable Toolkit source, and add generated-app guidance for selective app-owned UI customization.

## 0.6.0

### Minor Changes

- 01a3f27: BREAKING: move the portable composer, rich editor, collaboration display, visual controls, and shared UI primitives to focused Toolkit entrypoints. Core's removed deep compatibility paths now throw an actionable migration error, and moved symbols are removed from the legacy `@agent-native/core/client` barrel. Run `npx @agent-native/core@latest upgrade --codemods --yes` to rewrite supported imports. Framework-wired composer APIs remain available from `@agent-native/core/client/composer`; bare reusable composer UI is available from `@agent-native/toolkit/composer`.

## 0.5.1

### Patch Changes

- 079e19a: Adopt focused Core client entrypoints and ship package migration metadata where applicable.

## 0.5.0

### Minor Changes

- b6d7f87: Move portable rich-editor, context presentation, and visual design controls into Toolkit while preserving Core compatibility re-exports, and add accurate side-effect metadata to capability packages.

## 0.4.10

### Patch Changes

- 7effaba: Ignore malformed collaboration presence payloads and keep recoverable server chat timeout handoffs out of Sentry error issues.

## 0.4.9

### Patch Changes

- c690750: Button press feedback now eases instead of snapping: include the native `scale` property in the Button transition list (Tailwind v4 compiles `active:scale-*` to `scale`, which the previous `transform`-only list didn't animate).

## 0.4.8

### Patch Changes

- ffad302: Allow command dialogs to configure the underlying command root for custom ranking and controlled selection.
- ffad302: Ease in the backdrop blur for instant command dialogs while keeping the command surface immediately responsive.

## 0.4.7

### Patch Changes

- 38ca6fa: Motion polish across shared UI: overlay primitives (tooltip, popover, select, context/menubar menus) now scale from their trigger, exit with ease-out, and respect prefers-reduced-motion; new shared easing tokens (--ease-drawer, --ease-collapse, --ease-out-strong); press feedback on the shared Button and composer send button; GPU-friendly progress fills; chat tool cells (files-changed/edit/write) animate open/closed like other disclosures.

## 0.4.6

### Patch Changes

- f43d34c: Release the updated skill guidance and portable drawer component types.

## 0.4.5

### Patch Changes

- a91535c: Keep alert dialogs centered above full-app overlays.

## 0.4.4

### Patch Changes

- 680b1eb: Scan TypeScript sources from `@agent-native/toolkit/styles.css` so dropdown and popover `z-[250]` utilities are generated in monorepo apps where `dist/` is gitignored.

## 0.4.3

### Patch Changes

- 823d635: Add explicit `browser` and `development` export conditions so Vite 8 / Rolldown can resolve toolkit subpaths (including `./collab-ui`) in Fusion agent-native starter projects.
- 823d635: Upgrade the workspace toolchain to TypeScript 7 (`tsc`) with a side-by-side TypeScript 6 API package for tools that still need programmatic access. Replace `@typescript/native-preview` / `tsgo` with the stable `typescript` 7 release.

## 0.4.2

### Patch Changes

- ec523c4: Show the current sharing visibility icon directly in shared ShareButton triggers and use the users-group glyph for organization visibility.

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
