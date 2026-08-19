# @agent-native/toolkit

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

## 0.16.3

### Patch Changes

- 81fb79e: Keep shared composer labels theme-safe and translatable.

## 0.16.2

### Patch Changes

- 43fa797: Keep shared composer labels theme-safe and translatable.

## 0.16.1

### Patch Changes

- fb18771: Keep shared composer labels theme-safe and translatable.

## 0.16.0

### Minor Changes

- 9e21e1b: Add a Core-free data grid kit with keyboard navigation, selection, resizing, typed editor slots, and app-owned persistence callbacks.

### Patch Changes

- 9e21e1b: Align chat history rail overflow actions with trailing timestamps.
- 9e21e1b: Standardize share triggers, compact copy rows, and agent-sharing sections across framework surfaces.

## 0.15.1

### Patch Changes

- 73c4a97: Align chat history rail overflow actions with trailing timestamps.
- 73c4a97: Standardize share triggers, compact copy rows, and agent-sharing sections across framework surfaces.

## 0.15.0

### Minor Changes

- f07ec04: Localize the Core agent-chat interface and Toolkit composer across every supported locale, provide built-in Core translations with app-level catalog overrides, and guard the complete chat surface against new raw visible strings.

## 0.14.3

### Patch Changes

- 89f194f: Fix toolkit canvas interaction and collaboration UI behavior.

## 0.14.2

### Patch Changes

- 2db503b: Fix toolkit canvas interaction and collaboration UI behavior.

## 0.14.1

### Patch Changes

- b3b4580: Render chat-history row action menus in a collision-aware portal so rail menus are not clipped by the scroll container.
- b3b4580: Overlay chat row menus on timestamps and unread indicators without reserving a separate trailing column.

## 0.14.0

### Minor Changes

- aa17e22: Support bounded XLS/XLSX workbook previews as source context for `/make-into-app` and allow Excel workbooks in the shared composer attachment flow.

## 0.13.10

### Patch Changes

- 7c5888c: Make chat history rail overflow actions replace timestamps without layout shifts.

## 0.13.9

### Patch Changes

- dab8787: Fix the chat sidebar repainting glitches that made app content flash, shift, and
  render as flat empty rectangles while the agent was generating.

  Three properties on the always-mounted sidebar promoted or re-promoted a
  compositing layer on every app that renders `AgentSidebar`:
  - `will-change: transform` sat permanently on the sidebar panel (desktop, mobile
    and drawer variants). It wraps the whole chat transcript and is never
    unmounted, so the hint was never retired. The 260ms transform transition is
    promoted by the browser on its own for exactly as long as it runs.
  - `view-transition-name` was stamped on the panel unconditionally, including in
    apps that never start a chat view transition. A permanent name makes the panel
    a stacking context and the containing block for every fixed and absolutely
    positioned descendant, and enlists it as a captured group in unrelated route
    view transitions. It is now applied only while the wide-drawer morph runs.
  - The chat scroller's top-fade `mask-image` was added and removed with the
    `hasContentAbove` class, which flips as replies stream into an auto-scrolled
    transcript. The mask is now always declared and only its length changes.

  The same two defects existed independently on the workspace shell sidebar in
  `@agent-native/frame`, which hosts the agent panel, so the promotions nested.
  Fixed there too.

  Regression tests cover all three invariants, and a new repo-wide
  `pnpm guard:persistent-compositing` fails on any new compositing promotion on a
  long-lived surface. Genuinely transient elements (a popover that unmounts on
  close, a drag preview) opt out with a `compositing-ok: <reason>` comment.

- dab8787: Call model effort "Effort" in chat controls and default model selections to GPT-5.6 Luna with high effort.
- dab8787: Allow Slides to use a cleaner AI editing badge without a redundant status dot.

## 0.13.8

### Patch Changes

- c41fd16: Use theme tokens for collaboration edit highlight labels.

## 0.13.7

### Patch Changes

- 061896a: Add an opt-in chat-first workbench with contextual app surfaces for desktop, Dispatch, and mobile clients.

## 0.13.6

### Patch Changes

- cf16fae: Add an opt-in chat-first workbench with contextual app surfaces for desktop, Dispatch, and mobile clients.

## 0.13.5

### Patch Changes

- a107169: Fix PPTX/PDF import color and text fidelity: resolve theme/master colors (including `lumMod`/`lumOff`/`tint`/`shade` transforms) instead of defaulting to black, inherit per-level placeholder colors from the slide master, resolve each slide's own layout→master→theme chain instead of reusing the deck's first master (fixes wrong colors in presentations combining more than one template), recover per-run text colors and styles from PDF content streams instead of collapsing multi-color/multi-weight lines to a single style, treat a PDF's initial (unset) fill color as the known black default instead of an unresolved guess, preserve real PDF line spacing for bullet lists, bound concurrent PDF page image uploads, and fail clearly instead of silently importing a scanned/unrecoverable PDF as blank placeholder slides.

## 0.13.4

### Patch Changes

- da40677: Fix realtime voice tool calls failing with "Invalid or expired realtime voice capability" on serverless deploys. The capability minted by `/_agent-native/realtime-voice/session` lived in a per-process `Map`, so under `NITRO_PRESET=netlify` a tool call that landed on a different instance than the SDP request was rejected — the agent would report that it could not read the current selection and ask the user to reopen the editor. The capability is now an HMAC-signed token carrying the caller's identity, browser tab, and allowed tool names, so any instance can verify it.

  Two behavior changes follow from that. The grant no longer slides on use — it cannot be extended server-side — so its TTL is now an absolute 75 minutes, covering the provider's maximum session length. And when a `tool-search` widens the manifest, the tool response carries a re-issued capability that the client adopts; without it, calls to the newly discovered tools would 404.

  Fix dictation stopping instantly with no error anywhere. `SpeechRecognition` always fires `end` after `error`, and `useVoiceDictation`'s `end` handler returned the composer to idle — erasing the message `onerror` had just set. Every speech failure was therefore invisible in both the UI and the console. `end` no longer overwrites a reported error.

  Dictation also survives browsers that ship `SpeechRecognition` without a speech backend. Brave exposes `webkitSpeechRecognition` but removed the Google service behind it, so `auto` mode selected a recognizer that can only ever fail with `network`. In `auto` mode a recognizer that produced no text — because it failed, or because it ended before the microphone opened — now falls back to the MediaRecorder upload path. Permission and device errors are excluded, since retrying those through another provider fails identically. A mid-session drop that already captured speech keeps the transcript rather than failing over.

  The amplitude meter's own `getUserMedia` also moved to after recognition claims the microphone, since taking the device first can make Chrome abort the session.

## 0.13.3

### Patch Changes

- d3f8794: Allow hosts to configure the shared composer document attachment limit and label.

## 0.13.2

### Patch Changes

- 277be3f: Show "Queue message" in the chat composer tooltip when a submission will wait behind existing work.
- 277be3f: Keep the public app-config export available to browser-safe toolkit consumers.

## 0.13.1

### Patch Changes

- c71d383: Include the shared creative-context and toolkit updates in the next package release.

## 0.13.0

### Minor Changes

- 106af0e: Add dense horizontal variants to the design-tweak controls. `VisualColorPicker`
  gains a `swatch` variant that drops the value text and caret, an optional
  `glyph` rendered over the current color, and an app tooltip naming the property
  it paints. `VisualScrubInput` gains a `steppers` option that replaces the
  drag-scrub label with minus/plus buttons.

## 0.12.2

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.

## 0.12.1

### Patch Changes

- 89e5910: Memoize the composer runtime adapters context value so consumer effects stop
  re-running on every provider render. The voice input preference was re-read from
  app state, and the sidebar-state listener re-subscribed, once per render.

## 0.12.0

### Minor Changes

- c0e7d64: Add reusable canvas drawing, text annotation, and pinned agent-comment controls.
- c0e7d64: Add a reusable canvas interaction controller for text activation, shortcuts, moving, resizing, duplication, and gesture lifecycle.

## 0.11.2

### Patch Changes

- cc35067: Fix `VisualInspectorPanel` clipping its own scroll area instead of scrolling. The panel body was capped by a viewport-derived `max-height`, so when a host laid the panel out shorter than the viewport — for example a style dock sharing vertical space with an expanded notes panel — overflowing content was hidden by the panel's `overflow-hidden` with no way to reach it. The body now flexes within the panel's actual height and keeps the cap as an upper bound.

## 0.11.1

### Patch Changes

- 901769d: Keep the chat history panel layout balanced.
- 901769d: Remove the translate control slot from the shared sidebar footer actions.

## 0.11.0

### Minor Changes

- 24a5a20: Make extension creation and discovery opt-in, including authenticated REST
  creation, label SQL-backed extensions as sandboxed custom blocks, and let
  editors promote them into app code through a server-verified Builder handoff.

## 0.10.12

### Patch Changes

- 279e855: Default MCP connections to personal OAuth, keep personal MCP setup available to organization members, hide unusable organization controls, and honor app preset filters in ejected UIs.

## 0.10.11

### Patch Changes

- 0aada94: Allow the new chat control to fill the available history rail space.
- 0aada94: Show relative cost per model in the composer's model picker. Each row now
  carries a quiet `$`/`$$`/`$$$` suffix so a user can tell an entry model from a
  flagship one before selecting it, rather than discovering the difference in
  their bill. The tier reuses the token list the picker already sorts by
  (`MODEL_COST_ORDER`) and reflects each provider's own entry/mid/flagship ladder
  — it is not a cross-provider price claim. Models outside that list render with
  no label at all; a guessed tier would read as fact.

## 0.10.10

### Patch Changes

- 16a9d1a: Keep editor block drag previews aligned with the point where the block was grabbed, then clear incidental selection and focus after a successful drop.

## 0.10.9

### Patch Changes

- cbc6936: Show only the connect actions in the composer model picker when no LLM provider is configured, instead of a list of unpickable "needs API key" models, and surface Builder connect failures instead of leaving the "Connect Builder.io" button looking dead when the popup is blocked.

## 0.10.8

### Patch Changes

- 14818b6: Allow the first local edit in a newly synced empty collaborative document to reach the host application's canonical save path.

## 0.10.7

### Patch Changes

- 52cce19: Stop the agent composer from locking into a silently dead state. An
  engine-readiness check that timed out or failed is now kept distinct from a
  confirmed "no provider configured": it leaves the composer usable instead of
  disabling it, and retries on a backoff instead of latching until reload. The
  2.5s client budget that a single warm-server status probe routinely lost is
  now a 15s abort ceiling rather than a deadline the probes race. A composer is
  only ever disabled when the "Connect AI" affordance renders alongside it.

## 0.10.6

### Patch Changes

- 8afb252: Allow newly created empty collaborative editors to persist their first real user edit after the shared document finishes loading.

## 0.10.5

### Patch Changes

- 0e2c19d: Use borderless accent styling for shared secondary controls and organization pickers.
- 0e2c19d: Align shared chat history rails with left-aligned New Chat controls and animate chat-list expansion using intrinsic sizing.
- 0e2c19d: Expose a shared command-menu open event and sidebar footer action composition primitive.

## 0.10.4

### Patch Changes

- 4b734be: Give `SharedRichEditor` Notion-style block grips by default and keep the caret
  inside blocks created through the shared slash-command menu.

## 0.10.3

### Patch Changes

- 180b41d: Preserve native pointer, keyboard, accessibility, and ref props when legacy Toolkit buttons are composed as menu triggers.

## 0.10.2

### Patch Changes

- 2254362: Center full-page empty chat surfaces consistently and quiet the shared chat history rail.

## 0.10.1

### Patch Changes

- c15d20f: Harden browser and CLI error handling and hide editor commands for disabled features.
- c15d20f: Expand design-system conformance coverage for uncontrolled tooltip and menu
  opening, and align the example adapters with those default-open semantics.
- c15d20f: Show a soft rotating blue glow for live realtime voice sessions and brighten it while the agent is working.

## 0.10.0

### Minor Changes

- f0da2e0: Add the styling-runtime-agnostic custom design system contract, safe component adapters, semantic theme tokens, and build-time theme CSS generation. New scaffolded apps now include the explicit design-system module, ToolkitProvider seam, and toolkit dependency so custom adapters can be registered from the first render.

### Patch Changes

- f0da2e0: Harden custom design system color gamut handling, semantic default-adapter behavior, sharing controller reuse, and build-time theme cascade ordering. Add complete MUI and Ant Design Chat examples that exercise the public conformance contract, and route normalized settings, sharing, sidebar, and agent-panel chrome through the registered semantic adapters.
- f0da2e0: Preserve normalized core control icon sizing and semantic button styling while keeping settings defaults and sharing overlays consistent.
- f0da2e0: Serialize realtime voice responses and recover from overlapping response requests without ending the voice session.
- f0da2e0: Make the Dispatch chat composer recover from unavailable AI status checks and keep its Add menu clickable.
- f0da2e0: Route the Builder connection card and chat history rail through semantic design-system components while preserving their default presentation and shared controller paths.

## 0.9.1

### Patch Changes

- 03a043e: Make realtime voice the clear primary microphone action, remember the selected input mode, improve speech waveform responsiveness, and show a shine while the voice agent is working.
- 03a043e: Prevent reasoning messages from losing their assistant UI provider, and add a progressively disclosed recent-chat rail for app sidebars.

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
