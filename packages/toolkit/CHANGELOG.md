# @agent-native/toolkit

## 0.22.0

### Minor Changes

- dbb10d5: Remove the split auth marketing UI and route app entry pages through the shared sign-in flow.
- 39a89d0: Allow localized search placeholders for composer context categories and reuse the standard upload label for the first context-menu action.
- 39a89d0: Add connected cascading composer context menus with declarative search, list, link, loading, error, retry, and pagination behavior, plus persistent footer actions for existing links or modal workflows. Apps register authorized data loaders or local choices instead of rebuilding picker views. Allow host file-staging adapters through PromptComposer and AgentKitComposer while preserving shared upload controls and attachment chips, with an opt-out from ordinary text-file inlining when the host already extracts those files. Document scope resets and source-version refreshes, with localized defaults in every supported locale.
- 39a89d0: Add opt-in hierarchical composer context menus, attachment status and recovery controls, bounded immutable context snapshots, and a shared quick-start submission handle. AgentKit awaits a beforeSend hook and carries the same context metadata through immediate and queued submissions. Composer drafts, files, and context can be staged before provider setup while submission remains gated; hosts can use `submissionDisabled` without disabling staging.
- 39a89d0: Add declarative context dialogs for URL attachment and paginated multi-selection, with validation, cancellation, batch callbacks, and localized shared controls. Expose the additive picker configuration through AgentKit while preserving existing submenu pickers.

  Add read-only website composer source requests and the server-side readComposerWebsiteSource helper. Website references retain bounded extraction status, warnings, rendering provenance, and explicit truncation, while failed extraction remains an error.

- 39a89d0: Add shared prompt-home layout, controlled template/recent library tabs, and template cards with semantic design-system controls, native link slots, and explicit loading, empty, and error states. Include home geometry in Toolkit styles and the app-shell ejection unit, with localized component documentation.
- 39a89d0: Add a shared semantic template preview dialog with an inset viewport size, responsive thumbnail rail, keyboard selection, explicit loading/error/empty states, and app-owned rendered content. Align template menus beside captions, reveal them on hover or keyboard focus while keeping them visible on touch devices, and preserve direct primary activation and consistent card dimensions.

### Patch Changes

- 39a89d0: Preserve staged composer context when submitting through composer modes.
- Release all public npm packages with a patch version bump.

## 0.21.3

### Patch Changes

- Release all public npm packages with a patch version bump.
- 6ff4d47: Keep the shared agent chat composer visible above mobile keyboards.

## 0.21.2

### Patch Changes

- Release all public npm packages with a patch version bump.
- 2ba6541: Link Custom keys to API settings and keep the composer surface opaque.

## 0.21.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.21.0

### Minor Changes

- 21fdd86: Add the shared serializable icon contract and reusable resource icon picker.

### Patch Changes

- 21fdd86: Allow the resource icon picker to open from a persistent anchor outside a closing menu.
- 4917d34: Refresh the Builder model catalog and display current versions in the chat picker.
- Release all public npm packages with a patch version bump.
- ac01083: Align PDF attachment limits with their serialized message budget.
- 185e25d: Move the auth page Learn more link beside the marketing copy and show a GitHub icon on the open-source project link.

## 0.20.9

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.20.8

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.20.7

### Patch Changes

- 2427195: Add Claude Opus 5.5 and GPT-6 Sol/Luna to direct API model selection.
- d43305d: Allow editors to keep the latest local intent for overlapping changes while still merging independent server edits.
- Release all public npm packages with a patch version bump.

## 0.20.6

### Patch Changes

- Release all public npm packages with a patch version bump.
- e973e00: Move the auth form to the top of the page on small screens and hide the learn-more link there.

## 0.20.5

### Patch Changes

- 58b0779: Expand the shared font picker with curated Google Fonts.
- 3ecc476: Preserve Alt/Option modifier metadata through design scrub gestures for mirrored padding edits.
- Release all public npm packages with a patch version bump.
- 15ec2fb: Keep chat lifecycle state and queue rows clear of stale UI overlap, and reserve space for the share dialog close control.

## 0.20.4

### Patch Changes

- 5ede9f7: Keep editor recovery bases stable and combine non-overlapping concurrent edits before asking the user to recover a draft.
  Keep optional Node SQLite cache code from breaking Cloudflare Pages bundles.
- Release all public npm packages with a patch version bump.
- ffafd84: Keep tall dialog content inside the viewport with internal vertical scrolling.
- 424d0cd: Add `sortFontFamilyOptions` to alphabetize font family picker options (keeping "Inherit" pinned first), and use it in the Design and Slides typography font pickers.

## 0.20.3

### Patch Changes

- 901376b: Keep composer controls balanced, keep popovers within the viewport, and prevent first-run prompts from racing model authentication.
- b35949b: Distinguish acknowledged editor saves from external revisions during concurrent document reconciliation.
- 116c315: Keep embedded Design editor agent chat aligned with the shared sidebar and use concise OpenAI model labels.
- Release all public npm packages with a patch version bump.

## 0.20.2

### Patch Changes

- Release all public npm packages with a patch version bump.
- c9cb7de: Remove retired Macros app references from dispatch and toolkit surfaces.

## 0.20.1

### Patch Changes

- 9f08f5d: Fix "Connect Builder.io" doing nothing when it is clicked before the first Builder status read lands. `BuilderConnectPopover` rendered an ordinary enabled-looking trigger for the whole duration of that read, then discarded any click that arrived during it — on a cold serverless instance that window is seconds long, which is exactly when a brand-new signup reaches the Connect AI step. The trigger now holds the intent, marks itself `aria-busy`, and opens the provisioning consent choice as soon as the capability resolves. It never replays the intent into `flow.start()`, because that reaches `window.open` and browsers only permit it inside the click that asked for it; when the resolved capability has no consent choice to show, the intent is released and the now-resolved trigger answers the next click synchronously.

  `useBuilderConnectFlow` also exposes `statusReadSettledCount`, which increments whenever a status read settles regardless of outcome. `statusResolved` alone cannot bound a caller waiting on a read: a second failure leaves it `false` with no observable change, so a queued click keyed on it would wait forever. `retry()` now returns whether a read actually started, so a caller cannot wait on a disabled flow that will never read. The composer runtime adapter contract (`ComposerBuilderConnectFlow`) declares `retry` alongside it, so a non-core runtime can supply it and get the same behavior in `TiptapComposer`.

- cd40555: Give the sidebar chat rail's "more chats" control a disclosure chevron that
  flips with its state instead of the `IconDots` glyph the chat rows above it
  already use for their overflow menus. Hosts are free to pass the same label for
  both disclosure states — Brain, Assets, Factory, Plan, and Dispatch all pass a
  plain "Chats" — so the glyph was the only part of the control that could report
  state, and it never moved. Pressing it did expand the rail, but the button
  looked like a menu trigger that had silently failed.
- 1f43d89: Let apps opt into persistent sidebar scroll controls and edge cues.
- 25dc407: Unmount dismissed tooltips immediately so an exiting tooltip cannot consume Escape before the overlay beneath it handles the key.
- e32e1d5: Show on filter and sort triggers when the list they control is narrowed, via the new `FilterTriggerIndicator` primitive.
- Release all public npm packages with a patch version bump.
- 657bba1: Reserve a minimum gap between a menu item's label and its shortcut hint in `ContextMenuShortcut`, `DropdownMenuShortcut`, and `MenubarShortcut`. Previously the shortcut relied solely on an auto margin to push itself to the right edge, which collapses to zero when the menu's width is sized to fit its own widest row (e.g. "Send backward ⌘↓" in the Slides layer-order context menu), crowding the label and shortcut together.
- 25dc407: Improve visual numeric fields with parentheses, powers, opt-in per-target mixed-value math, and Option-drag scrubbing. Keep shared fields focused after Enter by default, with opt-in canvas focus return for Design inspector fields. Add optional text-value commits for unit-aware fields and an opt-in searchable font-family picker.
- 6ba23d3: Show a tooltip on every icon in the collapsed app sidebar rail. Sidebar link components now forward refs and unknown props, so the tooltip triggers around nav links, nav groups, and the brand mark actually attach, and the compact org switcher uses the shared tooltip instead of a native `title`.

## 0.20.0

### Minor Changes

- 210c7d0: Introduce AgentKit as one public package with subpath exports for the protocol,
  headless client, HTTP transport, transport conformance, and React runtime
  (`@agent-native/agentkit`, `/protocol`, `/http`, `/conformance`, `/react`, and
  `/react/*`), where the root and `/http` entries stay React-free; a
  versioned, provider-neutral protocol; validated messages, runs, capabilities,
  approvals, activities, smart objects, uploads, actions, participants, tasks,
  custom content, and durable thread snapshots; and typed compatibility,
  cancellation, and error semantics. Add the headless client, resumable HTTP and
  SSE adapters, executable transport conformance, and composable React provider,
  hooks, slots, registries, semantic UI, safe streamed Markdown, run recovery,
  host-aware copy confirmation, capability-gated feedback and forking with
  visible mutation state, and durable queued-message promotion.
  Add typed, replay-safe contextual connection requests with host-controlled
  setup, retry, decline, and resumable-run handling.
  Choice prompts now offer a focused custom response by default, preserve that
  answer separately from predefined option ids across transports, and let hosts
  disable the affordance for deliberately constrained workflows.
  Completed activity groups now collapse to a duration-aware “Worked for…” row
  while preserving their expandable action history.
  Execution segments now settle at the first visible assistant output rather than
  the terminal run event, so response streaming time is not counted as working
  time and hidden reasoning does not prematurely end the work phase.
  Active execution segments now expose a duration-aware “Working for…” spine and
  cluster consecutive equivalent default tool activity without discarding trace
  detail or overriding host renderers.
  The entire chat frame now owns transcript scrolling while the inner transcript
  retains its constrained reading measure, so wheel input works from either gutter.
  Activity traces now share a protocol-level semantic taxonomy, render distinct
  icons for searches, reads, edits, commands, checks, MCP calls, connections,
  navigation, delegation, and approvals, and give the run-level work spine its own
  identity instead of presenting every operation as a generic tool.
  Run startup now becomes active before the first streamed event arrives, keeping
  rapid follow-ups in the durable queue instead of launching overlapping runs.
  Transcript following ignores queue-only state churn, follows queue-driven
  viewport resizing, distinguishes programmatic scrolls from deliberate history
  navigation, and avoids redundant scroll writes during sustained streamed
  output.
  Chat shells can now preserve accepted AgentKit runs across thread navigation,
  observe typed per-thread lifecycle state in surrounding chrome, show background
  activity in rails, and surface a newly submitted conversation before durable
  history catches up.
  Host chrome now distinguishes active execution from the pre-response working
  phase, so progress indicators settle when visible assistant output begins while
  queueing and cancellation remain active through the terminal event.
  Core and AgentKit now share one animation-frame-paced streaming primitive with
  adaptive backlog draining, incremental grapheme segmentation, reduced-motion
  support, background-tab catch-up, and stable memoized Markdown blocks, avoiding
  chunk dumps and whole-response reparsing during long answers.
- 210c7d0: Add shared composer and clipboard primitives for a composable PromptBar, agent-authored next
  actions, a recessed message queue, contextual tool and slash discovery, voice
  controls, compact assistant actions, stable focus, accessible multiline input,
  and semantic elevation that remains correct across light and dark surfaces.

### Patch Changes

- 743039f: Clear a submitted prompt composer's persisted localStorage draft even when the host closes or unmounts the composer before the submit promise resolves, so an abandoned draft no longer resurfaces on the next mount. Also guard against a late-resolving submit from an unmounted composer clearing a newer draft that a fresh instance persisted under the same scope in the meantime.
- bd3e96e: Show a connection label instead of an unavailable model in the composer.
- b83d472: Clarify the difference between live voice chat and message dictation.
- 875f793: Fix three reported Content defects at their shared boundaries.

  `findConnectedMcpServersForProvider()` (new, from `@agent-native/core/mcp-client`)
  resolves the remote MCP servers a user or org has saved for one catalog
  provider, so an app-level status action can stop answering "not connected" for a
  provider that Settings shows connected. Any app that keeps its own provider
  credential registry alongside the MCP catalog had the same latent conflation.
  The provider host table moved to `@agent-native/core/shared/mcp-provider-hosts`
  so a server path can match provider URLs without importing the inlined logo data
  from the client catalog.

  `TaskListPasteNormalization` (new, from `@agent-native/toolkit/editor`) rewrites
  foreign checkbox-list HTML into the canonical `data-type="taskList"` shape
  before the schema parses it, so pasting a checklist from Notion or GitHub keeps
  its checkboxes instead of degrading to plain bullets. It is registered
  automatically whenever the shared editor factory's `tasks` feature is on.

  The shared block drag handle no longer opens its menu in the top-left corner of
  the window. `getBoundingClientRect()` answers an all-zero rect rather than null
  for a hidden, detached, or unlaid-out element, so the previous null-check never
  fired for the case that actually happens and the zero rect clamped the menu to
  the viewport padding. The menu now walks grip, block, and editor candidates and
  declines to open when none of them is laid out.

- 97564cd: Add reusable AppSidebar in toolkit and core, support top-left configurable alpha badges, and update app layouts to match the new sidebar design.
- 64e6346: Keep collaborative editors from briefly reverting edits received from another editor while SQL catches up, or indefinitely postponing accepted external content during presence updates.

  Advance the edit baseline when peer-delivered content already matches an accepted snapshot, preventing false conflicts on subsequent edits.

  Preserve subsequent local edits when an accepted replacement arrives through live sync before its saved revision, without treating identical shared changes as conflicts.

  Receive collab-backed canonical revisions through fresh Yjs sync receipts instead of inserting the same accepted text again from SQL. Preserve local edits and the confirmed merge base across delayed or failed delivery.

- 64e6346: Keep local rich-text changes from being rolled back while a controlled editor toolbar returns focus to the document.
- a30a54d: Undo and redo hotkeys now work right after committing a value in a numeric scrub field, which keeps focus after Enter.
- 587297c: Use GPT-Live as the default realtime voice transport with delegated app tools.
- Release all public npm packages with a patch version bump.
- 7a9238c: Support `.eml` chat attachments and present upload errors in a compact, dismissible banner.
- ccad889: Add an `unstyled` mode to `SharedRichEditor` so hosts can edit text in place without the shared prose typography or wrapper box.

## 0.19.7

### Patch Changes

- 35eb1e6: Align dropdown submenu trigger icon spacing with menu items (`gap-2`).
- 4676e71: Show popular OpenRouter models in the chat picker and preserve custom selections.
- Release all public npm packages with a patch version bump.

## 0.19.6

### Patch Changes

- e8b291e: Use the shared mouse-reactive wave animation as the branded auth background across all templates.
- 4915b82: Style Tiptap collaboration carets and labels so remote presence indicators stay compact and non-disruptive.
- Release all public npm packages with a patch version bump.
- 3bde94f: Reduce avatar border and presence-ring weight across shared app surfaces.

## 0.19.5

### Patch Changes

- Release all public npm packages with a patch version bump.
- 58d9dc3: Allow callers to keep the AI presence avatar display-only.

## 0.19.4

### Patch Changes

- e29fee8: Add a shared hook for browser-persisted sidebar collapse preferences.
- cef8c06: Route Clips' shadcn UI primitives through the shared Toolkit while preserving its intentional line-tab variant.
- Release all public npm packages with a patch version bump.
- 73c36ce: Preserve non-overlapping local edits when a newer authoritative rich-document revision arrives, and report overlapping changes without replacing the local draft.

## 0.19.3

### Patch Changes

- Release all public npm packages with a patch version bump.
- 760d108: Add an opt-in DataGrid edge affordance that reveals horizontally scrollable content without replacing the native scroll surface.

## 0.19.2

### Patch Changes

- Release all public npm packages with a patch version bump.
- 0566ce9: Expose resolved composer model selections so hosts can preserve them during attachment and recovery flows.

## 0.19.1

### Patch Changes

- e74593d: Keep the auth marketing learn-more action in a dedicated top-right layout row.
- Release all public npm packages with a patch version bump.

## 0.19.0

### Minor Changes

- a1869cc: Render the shared authentication surface with hydratable React and reuse its marketing composition for SSR app entry pages.

### Patch Changes

- Release all public npm packages with a patch version bump.
- 349ce5c: Persist Agent-Native prompt drafts synchronously and keep prompt surfaces isolated across refreshes.
- 353f95a: Split template marketing home routes from authenticated app entries and add the shared browser auth handoff.
- f0fb6c5: Use the cube spinner for shared loading indicators and the worded loader for full-page states across apps.
- 03711a6: Keep app launch loaders animated across remounts, randomize their labels, and smoothly resize the centered label.

## 0.18.0

### Minor Changes

- 163dd55: Add a shared font family picker for design and editor toolbars.

### Patch Changes

- 844fa10: Show the AI initials in collaborator presence avatars and expose the editing status on hover.
- 4af2889: Use the cube loader for app shells and agent activity, with long-running hints delayed to five minutes.
- Release all public npm packages with a patch version bump.
- dcc9f89: Remove the separate AI editing pill so the agent presence circle carries the status tooltip.
- 5b7a8ea: Replace flashing skeleton pulses with a smooth whole-surface loading shine.

## 0.17.6

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.17.5

### Patch Changes

- ac1ecfc: Keep slash-prefixed prompts when no command handler is available.
- Release all public npm packages with a patch version bump.
- 5a12f71: Use opaque white and soft-gray checkerboards for transparency.
- d2b314b: Keep uploaded files and pasted text visible in chat history without importing new-deck references.
- 5c96078: Use soft-gray checkerboards for transparency in shared visual color controls.

## 0.17.4

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.17.3

### Patch Changes

- db91905: Standardize Agent-Native product naming while preserving compatibility aliases for existing releases and profiles.
- Release all public npm packages with a patch version bump.

## 0.17.2

### Patch Changes

- 65a3b88: Keep shared feedback controls clear of the environment badge and editor chrome.
- Release all public npm packages with a patch version bump.

## 0.17.1

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.17.0

### Minor Changes

- cf473dc: Allow mention providers to show custom text or images with optional background
  colors, or to omit leading media, while preserving the existing icon fallback.

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.16.16

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.16.15

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.16.14

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.16.13

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.16.12

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.16.11

### Patch Changes

- 6c2e431: Show a terminal raw-source error when a persisted registry block cannot hydrate instead of leaving it indefinitely loading.
- af1b3bb: Stop silently dropping a collaborator's edits. A client that was not the reconcile lead never marked itself seeded, so its own changes were never written back
  to SQL — they survived in the shared CRDT while a peer stayed connected and disappeared when that peer left. Read-only viewers were also counted in the lead
  election, so a viewer could win it and then apply nothing at all, leaving a session where every editor's work was dropped.
- c595519: Adds a shared `afterBodyPointerUnlock` helper (`@agent-native/toolkit/ui/pointer-lock`) that defers opening a follow-up Dialog/Sheet/AlertDialog until `document.body.style.pointerEvents` is confirmed unlocked, avoiding the Radix dismissable-layer race where a new modal mounts before a closing one (with a nested Select) finishes unregistering and leaves the page permanently unclickable.
- 9735e4d: Fix the desktop agent picker readiness, tooltip stacking, and terminal mode control.
- 15b86eb: `VisualScrubInput` keeps focus on Enter instead of blurring, and selects the
  committed value the way Figma's inspector fields do. Blurring handed the next
  keystroke to whatever global shortcut owned that key, so typing a value and
  continuing to type could fire a canvas command (a zoom jump, in the report that
  found this) while the user believed they were still editing the field.

## 0.16.10

### Patch Changes

- Release all public npm packages with a patch version bump.

## 0.16.9

### Patch Changes

- 10de7b9: Remove unused imports and unreachable declarations. Dispatch drops unused
  imports from its layout, transactional email pages, and MCP gateway;
  creative-context drops unused type imports and an unread `headingStyle`;
  recap-cli drops the `node:os` import and two unread locals; skills drops the
  unreferenced `maybeUpdateInstructions` helper; toolkit drops unused imports and
  an unread `REALTIME_VOICE_REQUEST_SOURCE`. No runtime behavior changes.
  `eslint/no-unused-vars` is now an oxlint error instead of a warning, so CI
  blocks new ones.

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

- f0da2e0: Harden custom design system color gamut handling, semantic default-adapter behavior, sharing controller reuse, and build-time theme cascade ordering. Add public conformance coverage and route normalized settings, sharing, sidebar, and agent-panel chrome through the registered semantic adapters.
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

For the full list of releases, see the [changelog archive](./changelog/archive/CHANGELOG.md).
