# Slides interaction parity

This is the running desktop-editor evidence and disposition record for the
Google Slides interaction-parity effort. It records observed contracts and
reproduction targets; it does not claim that an area is 1:1 until a focused
test and a browser/editor check both pass. Visual/UI fidelity is tracked as a
separate first-class surface; behavior evidence alone does not establish it.

Last audited: 2026-09-14

## Reference contract

The desktop behavior baseline is the Google Slides web editor. The primary
authoritative references used for this audit are:

- [Insert and arrange text, shapes, diagrams, and lines in Google Slides](https://support.google.com/docs/answer/1696521?co=GENIE.Platform%3DDesktop&hl=en-en)
- [Google Slides keyboard shortcuts](https://support.google.com/docs/answer/1696717?hl=EN)
- [Add, delete, and organize slides](https://support.google.com/docs/answer/1694830?co=GENIE.Platform%3DDesktop&hl=En)
- [Crop and adjust images](https://support.google.com/docs/answer/4600160?hl=en)
- [Add and edit tables](https://support.google.com/docs/answer/1696711?hl=en)
- [Use a template or change the theme, background, or layout](https://support.google.com/docs/answer/1705254?hl=en)
- [Use Google Slides with a screen reader](https://support.google.com/docs/answer/1634140?hl=en)
- [Use comments, action items, and emoji reactions](https://support.google.com/docs/answer/65129?hl=en)
- [Insert or delete images and videos](https://support.google.com/docs/answer/97447?hl=en)
- [Link a chart, table, or slides to Google Docs or Slides](https://support.google.com/docs/answer/7009814?hl=en)

The reference set explicitly documents object ordering/grouping, alignment for
two or more objects, distribution for three or more, guide/grid snapping,
Shift-constrained movement/resize/rotation, 1° and 15° keyboard rotation,
object traversal, slide organization, and image crop/mask/opacity. These are
behavioral contracts to test, not proof that Slides currently matches them.

Google-specific language, branding, and cloud-sharing affordances remain out
of scope where the Slides app intentionally uses Agent-Native equivalents.

## Google Help references

Consulted on 2026-09-13 as authoritative desktop workflow references; they
define documented commands but do not substitute for direct Google Slides
observation of undocumented gesture details or parity evidence:

- [Keyboard shortcuts for Google Slides](https://support.google.com/docs/answer/1696717?hl=en-EN) — object nudge, rotation, grouping, z-order, shape traversal, slide navigation, and comments.
- [Insert and arrange text, shapes, diagrams, and lines](https://support.google.com/docs/answer/1696521?co=GENIE.Platform%3DDesktop&hl=en-GB) — arrange, align/distribute, snap-to-guides/grid, rulers, guides, and size/position.
- [Use a template or change the theme, background, or layout](https://support.google.com/docs/answer/1705254?hl=en-GB) — theme, per-slide vs presentation background, theme colours, and layouts.
- [Add, delete, and organize slides](https://support.google.com/docs/answer/1694830?co=GENIE.Platform%3DDesktop&hl=en) — duplicate/delete, multi-slide selection, drag reorder, filmstrip/grid view.

## Visual/UI comparison protocol

Visual fidelity is a separate parity surface from interaction behavior. For
each comparison, use the same fixture document, slide, browser viewport, browser
zoom, selected object(s), active tool, and visible panels in both editors.
Record each app's object IDs separately where imports remap them. Before the
first replay after the Slides slot is released, identify and freeze the build
served from this worktree: record its commit SHA, branch, serving URL/port, and
the server process/build identity. Do not compare a changing or unidentified
local build.

Capture matched reference/local screenshots before and after each replayed
interaction. Record the viewport dimensions and UI state with the screenshot
artifact paths or stable links; keep image files as artifacts rather than
embedding large binaries in this ledger. Compare:

- Canvas and panel geometry, alignment, density, and spacing.
- Typography, colors, separators, iconography, and control sizing.
- Default, hover, keyboard-focus, selected/multi-selected, loading, and empty
  states; include error or disabled states when both products expose an
  equivalent state.
- State transitions after the same pointer, keyboard/modifier, context-menu,
  and inspector action, including undo/redo and reload where applicable.

For each discrepancy, add the exact document/slide/object state, viewport,
screenshot references, exact repro steps, expected vs actual, owning code
boundary, focused regression, and a before/after screenshot pair for the fix.
Use overlays or pixel diffs at matched dimensions where useful, but describe
only the screenshots and states actually compared. Preserve intentional
Agent-Native branding/product boundaries and record them explicitly rather
than calling them visual matches. If a UI fix changes copy, update the English
source and configured locale translations together and run both i18n guards.

The first replay set prioritizes the inconclusive selection/modifier and
keyboard rows, then ungroup geometry, resize, grouping/z-order, duplicate, and
undo/redo/reload persistence. Capture visual and behavior evidence for each.

## Static source/test map (not execution evidence)

Static inspection only; no test, build, server, or browser run was started for
this checkpoint. The Shift/platform-primary click candidate remains
inconclusive, not a confirmed product defect. `SlideEditor.tsx` derives
additive mode from `shiftKey`/`metaKey`/`ctrlKey` in both
`handleSlidePointerDown` and the click-selection path; the click path toggles
the target builder ID and seeds the prior single selection when needed. The
editor test search found grouped-marquee coverage in
`SlideEditor.marquee.test.ts` and source-wiring assertions in
`SlideEditor.render-phase.test.ts`, but no direct modifier-click toggle test.
Next evidence needed: confirm delivered modifiers, selected IDs, and visual
selection in both editors from the same two-object fixture; then add a focused
editor event regression for add/remove membership. Google Help does not
specify the complete mouse-modifier contract, so observe it directly.

The apparent Shift+Arrow nudge gap is not confirmed: the Slides adapter maps
plain arrows to 1 px and Shift+Arrow to 10 px, and its focused unit tests cover
both. Google Help documents one-pixel versus larger nudges but not the larger
step size; measure it during the matched replay before deciding whether a code
change is warranted.

**Slot gate:** do not start a dev server, browser automation, or tests until the
user explicitly releases the Slides slot. The first runtime step after release
is to identify/freeze the served build above; then replay the priority cases in
the matrix before changing UI code.

## Coverage matrix

| Surface                        | Google contract to exercise                                                                                                                                         | Current disposition               | Evidence / next action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual/UI fidelity             | Same viewport and document/tool state; canvas/panels, density, spacing, typography, colors, separators, icons, and hover/focus/selected/loading/empty states        | Not yet replayed                  | After explicit slot release, freeze the worktree-served build and capture matched Google Slides/local screenshot pairs. Log exact state/repro, expected vs actual, code boundary, and after-fix screenshot; claim only captured states.                                                                                                                                                                                                                                                                                |
| Canvas selection               | Click selects; Shift/Cmd/Ctrl toggles; marquee selects; whitespace clears                                                                                           | Partial                           | Existing pointer/marquee paths. A Shift/Meta-click attempt did not visibly multi-select, but modifier delivery was inconclusive; rerun toggle, overlap, clear, and reload checks with a live editor                                                                                                                                                                                                                                                                                                                    |
| Object keyboard                | Duplicate, delete, nudge, Tab/Shift+Tab traversal, select-all                                                                                                       | Partially implemented             | Browser: Cmd+D creates a third shape; Cmd+Z removes it, Cmd+Shift+Z restores it, and reload keeps it. Tab traversal, select-all, delete focus, and nudge remain open                                                                                                                                                                                                                                                                                                                                                   |
| Clipboard                      | Copy, cut, paste, duplicate with object and slide focus                                                                                                             | Source fixes + tests added; unrun | Filmstrip Cmd/Ctrl+X/C/V/D now routes to slide cut/copy/paste/duplicate while focused; canvas object keyboard, appearance clipboard, and native-paste paths require canvas focus. See repros 23–24; browser/native clipboard, external formats, undo/reload, and direct Google focus behavior remain open.                                                                                                                                                                                                             |
| Resize and rotate              | Eight resize handles; aspect-ratio modifier; circular rotate handle; Shift rotation snapping                                                                        | Partially implemented             | Browser: southeast-handle drag by 28 px grows the shape by about 28 px per axis with fixed left/top; same-tab reload preserves exact CSS geometry. Translated mixed-selection rotation has focused matrix/translate tests; live rotation, modifiers, and group resize remain open                                                                                                                                                                                                                                      |
| Snapping and guides            | Object/canvas snapping; ruler visibility; add, move, delete, and clear manual guides; default Snap to Guides; Snap to Grid toggle; modifier bypass                  | Source-derived capability gap     | `snapSlideObjectMove` snaps to peer/canvas anchors and renders transient `AlignmentGuides`; source search found no ruler, persistent guide, or grid-snap state/control. See repro 19. Direct live UI comparison remains pending the serial slot.                                                                                                                                                                                                                                                                       |
| Align and distribute           | Align 2+ objects; distribute 3+ objects                                                                                                                             | Implemented in code/tests         | Geometry and toolbar callback coverage; browser verify dimensions, selection persistence, and undo/redo                                                                                                                                                                                                                                                                                                                                                                                                                |
| Grouping                       | Group selected objects; group acts as one object; ungroup restores members                                                                                          | Partially verified                | Browser verified for a two-shape group: single-group selection, child click, group reload, ungroup reload, undo, and redo. Multi-object geometry, nested groups, stack-order tie behavior, and rotated ungroup in-browser remain open                                                                                                                                                                                                                                                                                  |
| Z-order                        | Bring/send front/back and one-step forward/backward                                                                                                                 | Partially verified                | Browser: toolbar “Send to back” moved the overlapping duplicate to z-index 0 behind the original (1); Cmd+Z cleared the order, Cmd+Shift+Z restored it, and reload retained 0/1/2. Bring/front, one-step, pixels, equal-z peers, and keyboard/context remain open                                                                                                                                                                                                                                                      |
| Text editing                   | Single/double click entry, selection formatting, lists, Escape ownership                                                                                            | Partial                           | Rich-text and toolbar regression tests exist; browser muscle-memory and persistence pass remains                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Images and media               | Select, replace, crop/fit, position, drag/drop, external image paste                                                                                                | Partial                           | Image overlay/drop paths exist; crop, masking, external paste, and round trips need representative fixtures                                                                                                                                                                                                                                                                                                                                                                                                            |
| Shapes, lines, tables, charts  | Insert, select, edit, style, move, resize, table cell actions                                                                                                       | Partial                           | Shapes/tables are present; cover line endpoints, cell selection, charts, and advanced media in editor                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Slide rail                     | Ctrl+M insert after active using current layout; duplicate selected slides; multi-select; keyboard navigation/range selection/reorder; delete, skip, grid/list view | Source fixes + tests added; unrun | Google documents Ctrl+M insertion, arrow and PageUp/PageDown navigation, Home/End first/last focus, Shift range selection, multi-slide duplication, and platform-primary+Arrow reorder. The app keeps the blank-slide button intact and maps Ctrl+M to the active layout. `EditorSidebar` routes navigation/selection through its anchor-aware handler and reorder through the existing undoable mutation; `DeckEditor` duplicates the selected set. Browser/persistence proof is pending. See repros 20–22 and 25–26. |
| Layouts/themes/master behavior | Layout changes preserve editable objects and linked design-system tokens                                                                                            | Partial                           | Layout/design-system paths exist; Google master/theme equivalence versus intentional product behavior needs explicit disposition                                                                                                                                                                                                                                                                                                                                                                                       |
| Comments/collaboration         | Comment pins, threads, presence, selection handoff                                                                                                                  | Verified subset; partial overall  | Single-user anchored object/slide comments, replies, edit/resolve/reopen, reactions, scope/audience/search, shortcut, reload, and marker persistence are covered by focused tests and live editor evidence. Two-user presence, mentions/action items, and conflict/selection handoff remain unverified.                                                                                                                                                                                                                |
| Undo/redo                      | Object and slide edits undo/redo without clobbering remote/local state                                                                                              | Partial                           | Browser verified group and duplicate undo/redo; duplicate redo survives reload. Slide/deck mutation classes and remote-edit interaction remain open                                                                                                                                                                                                                                                                                                                                                                    |
| Zoom and pan                   | Zoom controls/shortcuts and canvas navigation remain selection-safe                                                                                                 | Partial                           | Zoom controls exist; keyboard/pointer navigation and selection/scroll preservation remain open                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Import/export                  | PPTX/PDF/HTML/Google Slides round trips preserve objects and metadata                                                                                               | Partial                           | Existing preservation contract; use stable seeded simple/advanced fixtures and compare before/after render and metadata                                                                                                                                                                                                                                                                                                                                                                                                |
| Agent-Native boundaries        | Selection/app-state, shared actions, persistence, reload and collaboration                                                                                          | Partial                           | Selection is published to app state; new group/rotation state has unit serialization coverage but not live reload evidence                                                                                                                                                                                                                                                                                                                                                                                             |

## Repeatable case matrix

These fixture definitions and scenarios are a test plan, not evidence. Each
fixture must be created from the same PPTX in Google Slides and in the local
Slides app, then captured before any interaction. The two imports may mint
different object IDs; use labels, slide order, rendered geometry, and content
as cross-app identity, and record each app's IDs separately.

| Fixture             | Stable starting content                                                                                                                                                      | Main coverage                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Simple (2 slides)   | Two overlapping rectangles, one ellipse, a free line, and two editable text boxes                                                                                            | Selection, focus, move/resize, copy/duplicate, text editing, undo/redo, basic slide-rail actions                     |
| Mixed (3 slides)    | A cropped image with an overlapping shape; a 4×3 native table; a native two-series chart                                                                                     | Image crop/mask/style, cell selection and formatting, chart selection/editing, object overlays                       |
| Advanced (5 slides) | Rotated and translucent shapes; three group candidates plus an unselected peer; four uneven alignment targets; a table and chart; a second image with separate text and line | Local-frame transforms, group/ungroup, equal-z ordering, alignment/distribution, slide rail, mixed-media persistence |

For every scenario, capture the untouched state, exercise pointer and keyboard
paths, then the available modifier, context-menu, and inspector/menu paths. Check
the visible result and persisted deck state; undo once, redo once, reload, and
compare again. Where an app intentionally lacks a Google-only service feature,
record that boundary instead of treating absence as a geometry or editor bug.

| Case                             | Reproduction and Google Slides oracle                                                                                                                                                                                                                                                                            | Cross-input paths                                                                                                                                                              | Persistence and regression oracle                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection and focus              | On Simple slide 1, click each overlap target, toggle a second object with Shift and platform primary-click, marquee the pair, then click whitespace. Capture actual Google Slides selection and hit order; the help pages do not define every selection gesture.                                                 | Pointer click/drag, Shift/primary modifier, `Tab`/`Shift+Tab`, `Cmd/Ctrl+A`, `Escape`, context menu / `Shift+F10`                                                              | Local editor selection IDs match the selected root objects and are published to `slides-selection`; selection clears or returns to the editor's documented focus owner. Reload checks persisted objects, not a transient selection unless app state promises it. |
| Object move and snapping         | Drag an object near another object's edge/center, then near a ruler guide and grid intersection. Guides snap by default; grid snapping is an explicit View setting.                                                                                                                                              | Drag, Shift-constrained movement, platform guide-suppression modifier, View menu, keyboard nudge by Arrow and Shift+Arrow                                                      | Record final canvas coordinates, visible snap guides, and setting state. Undo/redo/reload must restore the same object geometry without moving sibling objects.                                                                                                  |
| Resize and rotate                | On Simple slide 1, exercise all eight resize handles; use Shift for aspect ratio and the platform center-resize modifier. On Advanced slide 1, drag the visible handle of a rotated object, then rotate from its handle. Google lists Shift rotation snapping to 15° and keyboard rotation at 1°/15° increments. | Pointer handles, Shift/platform modifiers, `Option+Shift+←/→` (1°), `Option+←/→` (15°) on Mac; corresponding Google shortcuts on the tested platform; inspector numeric fields | Compare local-frame anchors, opposite-edge stability, transform origin, angle, and rendered bounds. Cancel with Escape, commit, undo/redo, and reload.                                                                                                           |
| Grouping and z-order             | On Advanced slide 2, group non-adjacent members across the unselected peer, move/resize/rotate the group, then ungroup. Google documents Arrange → Group and order actions; selected-layer tie breaking must be observed, not inferred from docs.                                                                | Toolbar/context menu; Mac `⌘+Option+G` / `⌘+Option+Shift+G`, PC `Ctrl+Alt+G` / `Ctrl+Alt+Shift+G`; Mac `⌘+↑/↓` / `⌘+Shift+↑/↓`, PC `Ctrl+↑/↓` / `Ctrl+Shift+↑/↓`               | Compare paint order and member geometry before/after group, ungroup, undo/redo, and reload. Include repeated preview updates and non-inline CSS transforms in the focused regression fixture.                                                                    |
| Clipboard and duplicate          | Copy, cut, and paste one object, a multi-selection, text inside edit mode, and a slide-rail selection. Duplicate with `Cmd/Ctrl+D`; compare drag-duplicate behavior with the host's platform modifier.                                                                                                           | Native shortcuts, context menu, object/slide focus, modifier-drag, external plain-text paste, image paste when clipboard permission is available                               | New persisted object IDs are unique; styles, geometry, and z-order are preserved. Undo/redo must affect one logical operation; reload must preserve committed content and not resurrect a cut object.                                                            |
| Text editing and formatting      | On Simple slide 2, enter text by double click, select a range, format only that range, change paragraph alignment/list state, then leave text editing with Escape.                                                                                                                                               | Single/double click, caret and range selection, toolbar, context menu, `Cmd/Ctrl+B/I/U`, list/align shortcuts, keyboard focus                                                  | Verify rich-text HTML/readback, selected range, caret ownership, final keystroke persistence, undo/redo granularity, and fresh-load rendering.                                                                                                                   |
| Images and media                 | On Mixed slide 1 and Advanced slide 5, move/resize/replace an image; test crop, mask, fit, border, opacity/brightness/contrast, and reset. Use video only if an editable video source is available.                                                                                                              | Pointer frame/crop handles, Insert menu, context menu, inspector/format options, drag/drop, external paste when permitted                                                      | Preserve intrinsic aspect ratio, source, crop, and mask independently. Read back after reload and round-trip. Mark media requiring an unavailable external account as blocked rather than passed.                                                                |
| Shapes and lines                 | Insert a shape and a line; edit endpoints, stroke/fill/transparency, line dash, and rotation; overlap the line with objects and move each endpoint.                                                                                                                                                              | Insert menu, pointer endpoints, keyboard selection/nudge, context menu, inspector/style controls                                                                               | Compare endpoints and object transforms, not just the line's axis-aligned box. Verify style and geometry through undo/redo/reload and PPTX import/export.                                                                                                        |
| Tables and charts                | On Mixed slide 2, edit cells and test the documented 20×20 insertion limit, row/column insert/delete, gridline resize, table-corner resize, selected-cell fill and borders. On Mixed slide 3, select and edit the native chart.                                                                                  | Cell keyboard navigation, right-click cell menus, table handles, toolbar/inspector, chart selection and context menu                                                           | Verify cell values, row/column dimensions, border/fill styles, chart series/categories and editability after reload/import. Do not require Docs-only table sorting, pinning, or row/column dragging in Slides.                                                   |
| Slide rail                       | Insert a slide with the current layout and with a different layout; Shift-select multiple slides; duplicate, reorder, delete, skip, then switch filmstrip/grid view.                                                                                                                                             | Rail pointer/context menu; Page Up/Down and slide-order shortcuts; `Shift+↑/↓`; `Cmd/Ctrl+↑/↓` and `Cmd/Ctrl+Shift+↑/↓`                                                        | Compare slide IDs and order, per-slide content/layout, skipped state, selection, thumbnails, undo/redo, and fresh load. Deletion must be undoable; skip must not delete.                                                                                         |
| Themes, layouts, and background  | Change theme, change a slide layout, set one-slide background, then apply a background to the theme. Insert a template slide only as a distinct import path.                                                                                                                                                     | Slide/Layout menus, theme sidebar, background controls, context menu where available                                                                                           | Record which slides and inherited styles changed. Preserve editable freeform objects and intentional Agent-Native design-system tokens; document master/layout differences as product boundaries, not silent equivalence.                                        |
| Comments and collaboration       | Anchor comments to text, an image, and a slide; reply, mention a collaborator, filter open/resolved, resolve/reopen, and test reactions. Repeat with two editor identities for presence, concurrent edits, and selection handoff.                                                                                | Toolbar/selection comment action, comment panel, comment keyboard shortcuts, pointer and keyboard navigation                                                                   | Compare anchor target, thread/reply order, resolution state, and notifications where available. Verify concurrent writes do not clobber local edits; do not claim presence from a single-user run.                                                               |
| Viewport, undo/redo, and reload  | Zoom in/out/reset, pan/scroll around a selected object, then apply representative object, text, slide, and theme edits.                                                                                                                                                                                          | Pointer wheel/trackpad, zoom controls, documented zoom shortcuts, keyboard focus movement                                                                                      | Selection and scroll behavior should match the reference capture; undo/redo must be scoped to one edit and not erase another object or remote change. Reload after each operation class and compare render plus action readback.                                 |
| Import/export and agent boundary | Round-trip each fixture through PPTX; also exercise Slides PDF/HTML export and Google Slides conversion separately. For each UI edit, read the result through the Slides action surface; for each action edit, confirm the editor updates.                                                                       | UI flow, export/import menus, `get-deck`/`view-screen` actions, navigation and application-state reads                                                                         | Compare slide count/order, editable objects, text, images/crops, tables/charts, notes/animation metadata, and known ID remapping. A successful download or upload alone is not a fidelity pass.                                                                  |

## First matched replay batch (after slot release)

Build the local app once from the exact checkout and commit, then serve that
immutable output without hot reload. Record the commit SHA, artifact/output
directory, serving URL and port, process command/PID, and verify the process
root is this worktree. The earlier retry that resolved Nitro from another
checkout and returned HTTP 500 is an invalid harness run: it is neither a
Slides product discrepancy nor a passing replay.

For each case, import the same fixture PPTX into both products. Match and record
the inner viewport dimensions, browser zoom, browser version, slide, visible
panels, active tool, selected object labels, and UI state. Capture paired
screenshots before and after each gesture. Record the two apps' object IDs
separately. Observe undocumented Google behavior directly rather than deriving
an expected result from a shortcut label or an assumed convention.

| Order                          | Matched start state and flow                                                                                                                                                                                                                                              | Evidence to compare                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Selection and keyboard      | Simple slide 1, same canvas viewport, no selection. Click rectangle A; Shift-click B; platform-primary-click B; marquee A+B; click whitespace. Refocus canvas and try `Tab`, `Shift+Tab`, `Cmd/Ctrl+A`, then `Escape`.                                                    | Capture each selection/focus state, delivered modifier keys, selection chrome, and selected labels/IDs. Record Google behavior as oracle; on the app, compare `slides-selection` and verify selection/focus after reload only where persisted. |
| 2. Group, ungroup, and z-order | Advanced slide 2, three overlapping group candidates with an unselected peer, same initial stacking. Select the non-adjacent pair; group through toolbar, menu, and platform shortcut in separate resets; move one step/front/back; resize and rotate the group; ungroup. | Capture wrapper/member bounds and paint order at each step. Compare equal-z tie behavior, unchanged peer geometry, undo/redo, serialized HTML, and fresh reload.                                                                               |
| 3. Resize and rotate           | Advanced slide 1, a labeled rotated/transformed object and a fixed peer, same selected object and visible handles. Drag each relevant local-frame handle by recorded viewport-pixel deltas; try aspect/center modifiers; rotate with and without snapping.                | Record pointer-down geometry, handle/frame pixels, pointer deltas, resulting local/world bounds, transform/origin, and peer position. Cancel once, commit once, then undo/redo/reload and compare.                                             |
| 4. Duplicate and persistence   | Simple slide 1, one labeled object selected with the canvas focused. Duplicate via shortcut, menu/context menu, and modifier-drag in separate resets; then undo, redo, and reload.                                                                                        | Compare new identity, geometry/style/stack position, focus/selection, number of logical undo steps, saved content, and screenshot state. Confirm undo does not resurrect after reload.                                                         |
| 5. Visual states               | Capture the same empty/blank slide, default editor, selected object, multi-selection, focused control, hovered control, loading, and empty-library states wherever an equivalent state exists in both apps.                                                               | Compare canvas/panel layout and density, spacing, typography, colors, separators, iconography, control dimensions, focus/hover/selection treatments, and loading/empty geometry. Record intentional product-specific differences explicitly.   |

For the high-priority gestures, capture Chrome performance traces in both
products on the same host and viewport. Measure input event to first visible
acknowledgement separately from input to persisted/save-complete state; use at
least ten warmed repetitions per gesture, report sample count and median, and
report p95 only when the sample count supports it. Preserve console errors,
failed network requests, and unexpected duplicate requests with each case.
The interaction evidence chain is: matched starting state + gesture → direct
Google oracle and expected/actual → owning code boundary → focused regression
→ fresh immutable-build UI replay → undo/redo/reload persistence. A unit pass,
preview health check, or failed wrong-worktree run cannot substitute for that
chain.

The fixture PPTX generator is staged under the ignored `.tmp/` directory but has
not been run or imported while the Mail-owned local build/test slot is held.
Google Slides API thumbnails can validate imported structure and appearance,
but they do not substitute for pointer/keyboard interaction in its editor.

## Exact repros, code disposition, and proof

These repros capture baseline defects and their shared boundaries. A code
disposition is not proof by itself; only the paths with explicit browser
evidence below are marked verified, and only for the tested cases.

1. Create two persisted absolute objects on one slide, select both, then press
   `Cmd/Ctrl+Alt+G`. Expected: one selected group containing both objects.
   Baseline actual: no grouping action. Root boundary: the Slides canvas
   adapter advertised grouping as unsupported and `SlideEditor` had no group
   command path. Code disposition: `groupSlideObjects`/`ungroupSlideObject`,
   selection actions, context-toolbar/context-menu controls, keyboard
   shortcuts, persistence, and sanitizer identity coverage were added. The
   wrapper is placed at the last selected sibling's DOM slot so the newly
   atomic group does not fall behind an unselected equal-z sibling; confirm the
   same ordering in Google Slides before treating that policy as verified.
   The two-shape group, member-click, fresh-load, undo/redo, and ungroup paths
   are now browser-verified in repro 13.
2. Select an absolute object. Expected: a rotate handle above the selection;
   dragging it rotates the object and Shift snaps to 15 degrees. Baseline
   actual: the selection outline rendered resize handles only. Root boundary:
   the overlay had no rotate gesture and the adapter set `rotation: false`.
   Code disposition: a rotate handle, Shift snapping, and 1°/15° keyboard
   increments were added with geometry and shortcut-resolver tests.
3. Select an object and press `Cmd/Ctrl+Up` or `Cmd/Ctrl+Down`. Expected: bring
   forward or send backward one layer. Baseline actual: the nudge resolver
   rejected primary modifiers and only front/back was wired. Root boundary:
   the editor had no step-wise z-order command. Code disposition: single/multi-
   selection step moves and keyboard/toolbar wiring were added with focused
   helper and callback tests.
4. Focus the canvas with an object selected and press `Tab` or `Shift+Tab`.
   Expected: traverse selectable objects in stacking/document order. Baseline
   actual: no canvas traversal handler, so focus followed browser tab order.
   Root boundary: object traversal was absent from the Slides keyboard layer.
   Code disposition: selectable slide roots are enumerated in canvas order and
   Tab/Shift+Tab traversal is wired; image-overlay selection now resolves to
   its persisted owner before advancing. Verify direct key dispatch in the
   browser.
5. Focus the canvas and press `Cmd/Ctrl+A`. Expected: select all selectable
   objects on the active slide. Baseline actual: no canvas select-all handler.
   Root boundary: the shortcut layer did not distinguish canvas selection
   from native text selection. Code disposition: Cmd/Ctrl+A selects the active
   slide's selectable roots only when focus is inside its canvas; verify the
   canvas/control boundary in the browser.

6. Select a grouped pair and drag a resize handle. Expected: members keep
   their relative arrangement and scale with the group bounds. Baseline actual:
   only the group wrapper changed size while child geometry stayed fixed. Root
   boundary: the single-object resize preview applied geometry only to the
   selected wrapper. Code disposition: resize preview now scales each grouped
   descendant in its local parent coordinates and restores original member
   styles on cancellation; geometry helper has focused nested-member coverage.
7. Select the first and third of three equal-z overlapping objects and group
   them. Candidate expected: the grouped object occupies the topmost selected
   sibling's stacking position. Baseline actual: wrapper insertion at the
   first selected sibling put the group's topmost child behind the unselected
   middle object. Code disposition: wrapper insertion now uses the last
   selected sibling's DOM slot; this policy remains an explicit Google-editor
   comparison item because the help reference does not specify tie-breaking.
8. Rotate an object whose inline transform is `matrix(2, 0, 0, 2, 10, 20)`.
   Expected: rotation changes while the object's scale and translation remain.
   Baseline actual: replacing the matrix with `rotate(...)` dropped both. Root
   boundary: transform replacement treated every matrix as rotation alone.
   Code disposition: 2D and planar `matrix3d` rotations now replace only the
   rotational component; a regression checks scale, translation, and angle.
9. Select an imported image through its image overlay, then press `Tab`.
   Expected: select the next top-level canvas object. Baseline actual: the
   traversal index was looked up from the non-image selection and restarted at
   the first object. Root boundary: the keyboard handler ignored the separate
   image-overlay selection state. Code disposition: traversal now resolves
   overlay selection to its persisted image owner, with a focused owner-order
   regression.
10. Rotate a group, then ungroup it. Expected: the former members retain the
    group's visible rotation and relative positions. Baseline actual: ungroup
    restored unrotated child coordinates and discarded the wrapper rotation.
    Root boundary: ungroup only added the wrapper's left/top to child geometry.
    Code disposition: ungroup now rotates member centers around the group
    center and applies the wrapper angle to each child's rotation; a focused
    90-degree regression covers both member positions and rotations.
11. Draw a rectangle from `[650,260]` to `[790,340]` on an inset AutoFit title
    slide. Expected: its bounds match the pointer drag. Baseline actual: the
    rectangle landed about 106 px left and 78 px above it. Root boundary:
    insertion used the inner AutoFit layer's origin while the positioned
    `.fmd-slide` ancestor owned absolute children. Code disposition: drawing
    and pasted text now resolve the CSS insertion containing block; helper
    tests and a live rectangle drag confirm the coordinate root.
12. Create/edit a text box, type, then immediately press Escape or switch
    slides before the 250 ms draft-capture timer fires. Expected: final text
    remains after leaving edit mode and reload. Baseline actual: the canvas
    and thumbnail showed the text, but the persisted slide omitted it. Root
    boundary: `disposeRichTextEditor` canceled the pending capture and only
    refreshed the undo snapshot, assuming the debounce had already queued the
    latest text. Code disposition: disposal now queues the final serialized
    draft when it differs from the last captured draft; focused regressions
    and a live immediate-Escape/reload check pass.

13. On a blank slide, marquee-select two persisted shapes and click Group.
    Expected: the pair becomes one selected group, the toolbar offers Ungroup,
    and the wrapper survives reload. Baseline actual: the DOM briefly wrapped
    the shapes but the editor stayed in “2 selected”; the operation returned
    before selecting or committing the wrapper, so reload showed two shapes.
    Root boundary: `stampBuilderIds(container)` stamps descendants only, while
    `handleGroupSelected` immediately asked `getBuilderSelector(group)` for
    the container's ID. Code disposition: `ensureBuilderId(group)` now assigns
    the wrapper ID before stamping its descendants; the handler then clears
    multi-selection, selects the wrapper, and commits the serialized content.
    Focused regression tests and browser evidence cover group selection, child
    click, toolbar and keyboard group/ungroup, fresh-load persistence,
    ungroup persistence, undo, and redo for a two-shape pair.
14. Select a 20×20 object at `(0, 0)` with `translate(20px, 0px)` and a peer
    at `(80, 0)`, then rotate the selection 90°. Expected: rotate their visible
    centers around the visual selection bounds while retaining the first
    object's translation; the resulting layout origins are `(30, -30)` and
    `(50, 30)`. Baseline actual: the shared plan used layout-only centers and
    bounds, placing them at `(40, -40)` and `(40, 40)` before the first
    object's preserved translation visibly shifted it. Root boundary:
    `rotateSlideObjectMembers`, shared by the pointer-handle and direct
    rotation paths in `SlideEditor`. Code disposition: rotation plans now
    derive the selection pivot and member centers from transformed visual
    bounds, then account for the target transform offset; focused regressions
    cover both `translate(...)` and `matrix(...)`. Browser interaction and
    reload evidence remain open because the local editor returned HTTP 500.
15. Group two objects, one with transform
    `matrix(0.8, 0.6, -0.6, 0.8, 10, -8)` and origin `25% 75%`, then resize
    the group from 100×100 to 200×50. Expected: the member transform becomes
    `matrix(0.8, 0.15, -2.4, 0.8, 20, -4)` with origin `20px 7.5px`, so the
    member follows the same nonuniform parent scale as its layout box.
    Baseline actual: only `left`/`top`/`width`/`height` changed; the matrix
    and transform origin stayed at their original values. Root boundary:
    `scaleSlideObjectGroupMembers` planned geometry without the transform
    snapshot. Code disposition: resize plans now scale the planar matrix and
    transform origin from pointer-down snapshots; focused test and reload
    verification are pending the serialized local test slot.
16. Give one selected member a CSS class with `z-index: 12`, give the other
    member inline `z-index: 4`, then group them. Expected: the wrapper inherits
    the highest effective non-auto member layer (`12`). Baseline actual: the
    wrapper was left at `auto` because grouping inspected only inline
    `style.zIndex`. Root boundary: `groupSlideObjects` ignored the existing
    effective-layer helper. Code disposition: grouping now reads computed
    non-auto z-index values; focused test and rendered stacking verification
    are pending.
17. Select a 100×50 object at `(100, 80)`, rotate it 90° around its center,
    then drag the visible right-middle selection handle 20 px right. Expected:
    that visual edge maps to the object's local north handle; the opposite
    local edge stays fixed and geometry becomes `(110, 70, 100, 70)`. Baseline
    actual: selection handles were placed on the axis-aligned 50×100 bounds,
    and the `e` handle fed world `dx` into unrotated axes, producing
    `(100, 80, 120, 50)` instead. Root boundary: `ElementSelectionOutline`
    exposed AABB handles while `startElementResize` trusted canvas-axis deltas.
    Code disposition: single-object chrome now follows the transformed local
    frame, and resize deltas/anchors are mapped through the immutable planar
    transform. Computed pixel origins are normalized to relative coordinates
    so a default centered pivot follows the resized box, while explicitly
    authored inline lengths keep their fixed-pixel meaning. Focused
    geometry/frame tests and browser interaction remain pending.
18. Start rotating two differently sized objects, move the pointer to a
    10° preview, then continue to 20°. Expected: the second preview is computed
    from the pointer-down transform snapshots and matches a direct 20° preview.
    Baseline actual: each preview read the live mutated CSS transform while
    reusing the original layout geometry, shifting the transformed union
    center and rotating around a drifting pivot. Root boundary:
    `rotateSlideObjectMembers` mixed live transforms with immutable `start`
    geometry. Code disposition: rotation members now capture transform and
    origin once and return the planned transform; repeat-preview regression
    and browser drag/reload evidence are pending.
19. Source-derived capability gap — ruler, manual guides, and grid snap. Google
    Slides Help documents showing/hiding rulers, adding and dragging guide
    lines, deleting one guide or clearing all guides, default Snap to Guides,
    and an optional Snap to Grid setting ([arrange and align objects](https://support.google.com/docs/answer/1696521?co=GENIE.Platform%3DDesktop&hl=en-GB)).
    Expected local flow: open the editor's view controls, show a ruler, create
    and move a guide, snap an object to it, delete/clear guides, and toggle
    grid snapping. Source-derived actual: under `templates/slides/app`, the
    only guide implementation found is `snapSlideObjectMove` plus the
    `AlignmentGuides` overlay, driven by nearby object/canvas anchors during
    a drag and cleared when that gesture stops; no ruler, persistent guide
    model, guide manipulation handlers, or grid-snap preference/control was
    found. Root boundary: there is no manual-guide/grid state or view-control
    path to compare or persist. This is a documented capability gap from source
    inspection, not a live-browser observation; no UI/code fix is attempted
    until the local editor slot is released and the product boundary is
    confirmed.
20. Filmstrip keyboard reorder. Google documents `⌘+↑/↓` to move the focused
    slide up/down and `⌘+Shift+↑/↓` to move it to the beginning/end on Mac
    ([keyboard shortcuts](https://support.google.com/docs/answer/1696717?hl=en-EN));
    the platform-primary form covers Ctrl-based desktop shortcuts too. Before
    the fix, `SortableSlideThumb` passed key events to sortable listeners and
    then routed every Up/Down chord to `navigateToSlide`; it had no keyboard
    reorder callback, despite `DeckEditor` already exposing the undoable
    `reorderSlides` mutation for pointer drag. Code disposition: the thumbnail
    now intercepts primary+Arrow (primary+Shift+Arrow to an edge) and calls
    that existing mutation, preserving a contiguous selected range as a block.
    Focused event regressions were added for one-step move and range-to-edge;
    they have not been run, and live key delivery/order/focus persistence
    remain unverified until the serial slot is released.
21. Filmstrip keyboard range selection. Google documents Shift+Up/Down to
    select the previous/next slide in the filmstrip ([keyboard shortcuts](https://support.google.com/docs/answer/1696717?hl=en-EN)).
    Before the fix, thumbnail arrow navigation discarded `shiftKey`, and the
    document-level navigation listener did the same, so both paths changed the
    active slide without extending the range. Code disposition: both paths now
    forward Shift to `onSelectSlide`, reusing the existing anchor-aware
    `getSlideSelection` behavior used for Shift-click. Focused event regressions
    were added for focused-thumbnail and document-level dispatch; neither has
    been run, and selection visuals, anchor continuity, undo/reload, and direct
    Google behavior remain unverified until the serial slot is released.
22. Filmstrip Home/End and page navigation. Google documents Home/End to move
    focus to the first/last slide, PageUp/PageDown as previous/next on PC, and
    Shift+Home/End to select through the first/last slide ([keyboard shortcuts](https://support.google.com/docs/answer/1696717?hl=en-EN)).
    Source inspection found `getNextSlideId` supported only one-step arrows.
    Code disposition: focused-thumbnail navigation now handles Home, End,
    PageUp, and PageDown through the same slide-selection path, preserving
    Shift for range selection; document-level keys remain narrowly scoped to
    arrows. Focused event cases are added but unrun, and live focus, selection,
    reload, and platform-specific behavior remain open until the serial slot
    is released.
23. Focus ownership when canvas selection remains visible. Google documents
    Cmd+D as duplicate and lists filmstrip movement/selection separately in the
    [keyboard shortcut reference](https://support.google.com/docs/answer/1696717?hl=en-EN).
    Exact replay candidate: on a slide with one selected freeform shape, focus
    that same slide's thumbnail and press Cmd+D; then repeat Cmd+C/V. Expected
    from the focused filmstrip contract: copy/duplicate/paste the slide, not
    the still-visible canvas object. Static source path before the fix: the
    DeckEditor rail handler declined whenever any selected-object marker
    existed, while SlideEditor's window clipboard handler had no canvas-focus
    guard and could consume Cmd+D/C; its capture-phase native paste handler
    could claim the rail's paste too. Code disposition: rail focus now owns
    slide clipboard shortcuts, while object keyboard, style clipboard, and
    native-paste handlers require canvas focus. Focused source regressions were
    added. This collision is source-derived, not a live observation; test
    execution and direct Google/local replay remain pending the serial slot.
24. Filmstrip keyboard cut. Google documents Cmd/Ctrl+X as Cut in its common
    shortcut list ([keyboard shortcuts](https://support.google.com/docs/answer/1696717?hl=en-EN)); the slide rail already exposes a Cut context-menu item and
    `DeckEditor.cutSlides` preserves a local slide clipboard before deletion.
    Before the fix, the rail keydown handler accepted only C/V/D, so X could
    not invoke that slide operation. Code disposition: focused Cmd/Ctrl+X now
    cuts the selected slide set through `cutSlides`, leaves a rendered-text
    selection to native browser behavior, and retains the existing protections
    against cutting all slides or mutating source-imported decks. A source
    regression was added but not run; direct Google behavior and cut/paste
    undo/reload remain pending the serial slot.
25. Keyboard duplication of a selected slide set. Google Help says multiple
    slides can be selected with Shift and duplicated together; the shortcut
    reference lists Cmd/Ctrl+D for duplicate ([organize slides](https://support.google.com/docs/answer/1694830?co=GENIE.Platform%3DDesktop&hl=en),
    [keyboard shortcuts](https://support.google.com/docs/answer/1696717?hl=en-EN)).
    Before the fix, the filmstrip shortcut called `handleDuplicateSlideFromRail`
    with only `[activeSlideId]`, while the context-menu path passed the whole
    selected set. Code disposition: the focused rail shortcut now forwards the
    selected IDs when they contain the active slide and otherwise falls back
    to that slide alone. A source regression covers selection forwarding but is
    unrun; directly confirm the keyboard shortcut duplicates all selected
    slides, then verify order/selection, undo/redo, and reload after the serial
    slot is released.
26. New-slide keyboard shortcut and layout. Google documents Ctrl+M to add a
    slide on both PC and Mac ([keyboard shortcuts](https://support.google.com/docs/answer/1696717?hl=en-EN)).
    Before the fix, the Slides editor had no Control+M route; its existing
    toolbar action intentionally inserted a blank slide instead. Code
    disposition: the shortcut now uses the current slide layout (content when
    no current slide exists), inserts after the active slide through the
    existing optimistic add-slide path, and keeps the blank toolbar action
    unchanged. Editable/read-only/blocking-surface and modifier guards have
    focused helper tests, and a source regression checks active-layout routing;
    all are unrun. Live focus, same-layout rendering, save timing, undo/redo,
    reload, and direct Google comparison remain pending the serial slot.

## Review findings — 2026-09-13

- Inline draft disposal (comment 3998157294): the normal edit-entry path seeds
  both the initial and latest snapshots before the debounce timer starts. The
  reported null-capture case was not reproduced through that path, but the
  persistence helper now compares an uncaptured final draft against the
  initial snapshot. Focused tests prove changed content persists and a true
  no-op does not; live disposal/reload was not rerun.
- Matrix rotation (comment 3998157295): false positive. The matrix helper
  factors out the existing angle, preserves the residual scale/shear and
  translation, then applies the requested absolute angle. A new 15°→30°
  regression proves the resulting angle is 30° with scale 2 and translation
  (10, 20) unchanged.
- Group marquee identity (comment 3998157296): confirmed. Leaf-only hit testing
  could return grouped members instead of their wrapper. Marquee candidates now
  resolve to the nearest group root, hit-test its bounds, and add its single
  builder id. Helper and editor-wiring regressions pass.
- Rotated group bounds (comment 3998157298): confirmed. Group construction
  previously unioned layout rectangles only. It now transforms each member's
  corners through its planar CSS matrix and transform origin before forming the
  wrapper bounds; a 90° member regression verifies the resulting bounds and
  child offsets.
- Ungroup stack position (comment 3998157299): confirmed. Ungrouping now sorts
  members by their inner paint order and assigns them the wrapper's outer
  stacking slot, preserving the group's position relative to siblings. A
  bring-to-front → ungroup regression verifies the members remain above an
  equal-z sibling.
- Multi-object rotation with existing translation (comment 3998400907):
  confirmed. The shared plan previously rotated layout centers while
  `setSlideObjectRotation` retained transform translations, causing visual
  drift. It now plans from transformed bounds and compensates for the target
  transform offset; matrix and `translate(...)` regressions pass. Browser
  rotation/persistence verification remains open.
- New review candidates on the pushed head (comments 3998534017, 3998534018,
  3998534020, and 3998534022): all four reproduce at the shared transform and
  effective-layer boundaries described in repros 15–18. Focused regression
  coverage and source fixes are prepared, but no local tests have been run
  while Mail owns the serialized test slot. The authenticated editor check is
  still unavailable because the only open Slides preview is at sign-in.
- CSS-only transforms during rotation (comment 3998589418): confirmed on the
  pushed head, where rotation could compose from an empty inline transform.
  The current local fix captures the effective transform before both keyboard
  and pointer previews and composes from that snapshot. A new class-backed
  matrix regression checks that scale and translation survive; test and
  browser evidence remain pending.

## Evidence run and remaining blocker (2026-09-13)

Automated evidence collected:

- Full Slides suite before this review round: 1,833 passed across 200 files.
- Latest group/selection/geometry-focused run: 150 passed across three editor
  test files. The latest edit-session/render-phase run before that: 27 passed
  across two files.
- Review-fix regressions: 128 passed across the inline-edit-session,
  slide-object-interactions, and SlideEditor.marquee test files.
- At an earlier workspace-prep attempt after the review fixes, the root
  formatter completed and Slides typecheck reported Done, but workspace tests,
  unrelated package typechecks, and the MCP registry guard failed on missing
  local dependency links and production-only environment configuration. The
  Core test lane stalled amid unrelated harness errors and was interrupted;
  the focused Slides tests above passed independently.
- At that earlier checkpoint, `pnpm --filter slides typecheck` exited
  successfully; the framework also
  printed its existing production auth/database configuration diagnostics.
- Current source-prep checkpoint: `EditorSidebar` regressions cover one-step
  and boundary reorder, Shift+Arrow range selection from both event paths,
  Home/End, PageUp/PageDown, and Shift+Home/End. Static source regressions in
  `SlideEditor.render-phase` and `DeckEditor.slide-clipboard` cover canvas vs
  filmstrip shortcut ownership, safe slide cutting, and selected-set duplicate
  forwarding. `editor-shortcuts` and `DeckEditor.shortcuts` cover Control+M
  guards and same-layout insertion. All remain unrun while the serial slot is
  held. Oxfmt completed on nine changed TypeScript files and `git diff --check`
  passed. The latest `pnpm --filter slides typecheck` could not complete because
  Vite failed to write its temporary config with `ENOSPC` (the volume had about
  266 MiB available). A direct no-emit TypeScript attempt also stopped before
  checking project sources: the worktree shim resolved TypeScript 7 from the
  shared checkout, then Node 18.15 rejected its extensionless entrypoint with
  `ERR_UNKNOWN_FILE_EXTENSION`. No caches or `.tmp` artifacts were removed or
  modified. No focused test, production build, server, or browser replay has
  been run for the current source-prep changes; all remain pending explicit
  serial-slot release.
- Oxfmt completed on all 24 modified TypeScript files. Both i18n guards and
  `git diff --check` passed.
- The post-format focused suite passed 178 tests across six changed editor
  test files. `pnpm guards` ran 73 checks; the first run had 71 passes and two
  failures. The Agent-Native brand-label finding was corrected and its guard
  passes on rerun. `guard:mcp-registry` still cannot start because `ajv@8.20.0`
  is declared and in the pnpm store but missing the root `node_modules/ajv`
  link; the shared dependency tree was not modified.

Live app evidence collected:

- Local fixture deck `u88BkOLitP` (`Interaction Parity — Placement
Verification`): a rectangle dragged from `[650,260]` to `[790,340]` renders
  at those canvas coordinates after the insertion-root fix. Text created by
  drag remains after slide switching and reload; a fast final keystroke
  followed immediately by Escape also survives reload.
- On slide 3 of that fixture, a marquee over two shapes followed by Group now
  selects one wrapper (`Ungroup` appears); clicking either child keeps the
  wrapper selected. A fresh load preserves `.fmd-slide-group` and both member
  IDs in the slide DOM (the accessibility tree flattens the wrapper). Cmd+Z
  removes the wrapper and Cmd+Shift+Z restores it; Ungroup leaves two
  independent shape roots and a fresh load keeps them ungrouped. Cmd+Option+G
  and Cmd+Option+Shift+G also group/ungroup successfully; a same-tab reload
  preserves the shortcut ungroup result.
- On slide 3, dragging the southeast resize handle by 28 px grows the selected
  shape by about 28 px on both axes without changing its origin; same-tab
  reload preserves the exact `left`, `top`, `width`, and `height` styles.
  Cmd+D creates a third shape; Cmd+Z removes it, Cmd+Shift+Z restores it, and
  the three-shape state survives reload.
- On slide 3, selecting that overlapping duplicate and using toolbar “Send to
  back” assigns it `z-index: 0`, below the original at `1` and the non-overlap
  shape at `2`. Cmd+Z clears the order values, Cmd+Shift+Z restores them, and
  a post-hydration reload preserves the `0/1/2` ordering. Pixel-level overlap
  appearance and the other ordering commands remain unverified.
- On the ungrouped slide 3, attempted Shift-click and Meta-click on the second
  shape did not visibly create a multi-selection; Control-click opened the
  object context menu. Because the modifier delivery could not be confirmed
  and the local editor then became unavailable, this is inconclusive—not a
  confirmed parity defect or a passing check.
- Google Slides is open only at its sign-in page in the in-app browser; no
  credentials have been entered. No side-by-side reference deck or simple /
  advanced recreation has been completed.
- The local dev server became unavailable after its Vite config reload failed
  to resolve the Nitro dev-entry module. Its PGlite directory was owned by
  another process, which was left untouched. No keyboard z-order proof or
  browser checks after that point are claimed.
- A 2026-09-13 retry started Vite at localhost:8080, but Nitro resolved its
  dev-entry from a different checkout and the app root returned HTTP 500. The
  in-app browser stayed on “Dev server is restarting…”; no review-fix browser
  interaction was claimed, and the Vite config and shared PGlite data were
  left untouched.
- Browser checks for selection toggling, rotation modifiers, z-order,
  multi-object alignment/distribution, native clipboard, object/media/table/
  chart editing, rail operations, themes/layouts, comments/presence, and
  import/export remain open. The local checks above are evidence for those
  specific paths only.

### Latest review-fix verification (2026-09-13)

- The matrix/translate rotation repro now passes in the 130-test focused
  interaction + marquee run. Standalone Slides TypeScript checking and
  `guard:no-silent-coercion` pass.
- The Builder review summary on the previous head also listed west/north group
  resize drift, translated-child loss when ungrouping a rotated group, and
  contiguous-selection one-step ordering as remaining findings. Current-head
  dispositions, all passing in that same 130-test run:
  - Group resize applies the resized wrapper rect before scaling descendants in
    their local coordinates; the west/north regression compares resulting
    world positions against the fixed opposite edges. No additional geometry
    change was indicated by the helper and editor call path.
  - Rotated ungrouping now rotates each translated child's visual center around
    the wrapper center and adjusts its layout origin; matrix and `translate()`
    regressions check the resulting center and retained angle.
  - One-step multi-selection ordering swaps the selected block past exactly
    one adjacent unselected layer; forward and backward contiguous-selection
    regressions check the resulting layer indices.
    These are code/test dispositions, not live-browser proof; grouped resize,
    rotated ungroup, and multi-selection ordering remain open in the interaction
    matrix until exercised in the editor.
- The deployed PR preview at
  `https://pr-4887--agent-native-slides.netlify.app` loads the Slides sign-in
  screen. No credentials were available or entered, so no authenticated editor
  interaction was verified from that preview.
- A review follow-up reproduced two related matrix cases: a scaled/sheared
  child with a 14.5° matrix angle and a `25% 75%` transform origin, inside a
  200×100 group rotated 90°, had an expected visual-center x of `227.4924` but
  landed at `227.3342`; separately, a matrix angle of `12.5°` read back as
  `13°`. Root boundary: `readSlideObjectRotation` rounded `atan2` before
  ungroup composed the child's matrix. Code disposition: matrix angles retain
  fractional precision, and ungrouping now computes center offsets from the
  complete current and next planar matrices. Focused regressions cover both
  15°/14.5° scaled-shear centers and 12.5° angle preservation; all pass in the
  130-test run.
- The full local guard sweep still cannot complete because the worktree lacks
  the root `ajv` link required by `guard:mcp-registry`. CI also timed out once
  in the unrelated `generate-image-api` test; the exact test passed when run
  alone locally. The next PR CI run remains the merge gate.
- No new browser evidence was collected for rotation. Google Slides sign-in,
  representative side-by-side deck recreation, and all previously listed
  partial/open interaction areas remain outstanding; this matrix does not
  claim 1:1 parity.

- New Builder review candidate 3999683455 (2026-09-13 12:58Z): create a group
  whose child DOM order is front-first (`z-index: 4`) then back-second
  (`z-index: 1`), with an equal-z outside sibling, and ungroup. Expected:
  extract children in inner paint order and retain the wrapper's outer slot.
  The repository sweep found one DOM-based stack-restoration implementation
  (`ungroupSlideObject`), one `SlideEditor` command caller, and its direct
  interaction tests. The separate Design `runUngroupSelection` path edits
  CodeLayer content and does not restore DOM z-index, so it is not the same
  boundary and remains out of scope. In Slides, `childGeometries` is already
  sorted from low to high effective z-index, then each child is inserted before
  the wrapper in that same sequence; assigning the shared wrapper z-index
  leaves that order as the equal-z DOM tie-break. A focused regression now
  checks inverse DOM/z-index order, the outside sibling slot, and sanitized
  serialize/reparse order. No production change is indicated by source
  inspection; remote CI and inline disposition are pending, and browser paint
  verification remains unavailable at the signed-out preview.

## Release-slot verification — 2026-09-14

The Slides slot was explicitly released for this run by the user, who also
authorized the guarded `/ship` flow. The immutable browser harness was built
from the working-tree snapshot on branch `steve8708/changes-8070` at base SHA
`babdc126f44fb45091d98c0e84c12b58d78613d2`; the snapshot was intentionally
dirty because it contains the parity changes being verified. The build command
was `./node_modules/.bin/agent-native build` with the bundled dependency paths,
and it exited 0. The served artifact was `templates/slides/.output` built at
19:11:15 PDT. The local server ran from this worktree at
`http://127.0.0.1:4174/` as PID 65402 with a fresh ignored PGlite database at
`.tmp/slides-qa-db-20260914-r9`; `ps` and `lsof` confirmed the process root and
port. Expected existing build diagnostics about production credentials and
database configuration were printed; they are deployment configuration
requirements, not browser-run failures.

### Direct Google Slides oracle

The comparison deck was the private QA deck `Slides Comment Parity QA` in
Google Slides, viewed in the same 1280×720 Codex browser viewport as the local
editor. The tested sequence and observed Google contract were:

1. Select a rendered rectangle. The selection toolbar exposes Add comment.
   `⌘+Option+M` opens an inline draft immediately; the textbox is labelled
   `Comment or add others with @`, Post Comment is disabled for an empty draft,
   and Discard comment cancels it.
2. Select text inside a text object and invoke the same shortcut. Google opens
   the draft with the text selection as the comment target. A slide-only click
   followed by the shortcut opens the same draft without entering a persistent
   pin-placement mode.
3. Post an object comment and a slide-position comment. Each appears as an
   anchored contextual thread with author, timestamp, resolve, more-options,
   reaction, and reply affordances. Reply uses `Reply or add others with @` and
   increments the thread reply count.
4. More options exposes Edit, Delete, emoji-reaction details, and Get link to
   this comment. Edit uses an `Edit your comment...` draft and Save remains
   disabled until the content changes. Resolve removes the thread from the
   contextual open list.
5. Show all comments opens the full Comments panel with All comments and For
   you tabs, search, comment-type filtering (open/resolved), and location
   filtering (this slide/all slides). For you excludes the self-authored QA
   comments, so the local audience filter was treated as a direct oracle rather
   than inferred from documentation. The resolved thread remains represented in
   the full panel as Resolved and can be reopened from its menu.
6. The Google Help page confirms the documented comment, action-item, and emoji
   reaction contract; direct editor observation above supplies the focus,
   draft, filter, and cancellation details that the help page does not fully
   specify.

### Local editor replay and dispositions

The same worktree build was reloaded into a fresh local QA deck
`4_TEuP6itI`. A newly created deck mounted with two slides and no React hook
count error; this is the regression for the loading-to-loaded render boundary
where hooks had previously sat below an early return.

- On a focused blank slide, `⌘+Option+M` produced the local Comments panel with
  an empty text entry area, Cancel, and a disabled Comment button. The AX tree
  did not expose the `Click anywhere to drop a comment pin` hint, matching
  Google's immediate-draft behavior. The listener now claims the Google chord
  during capture, accepts the physical `KeyM` code, and does not discard the
  shortcut merely because an underlying canvas handler already prevented its
  default action. Plain `C` remains a separate, intentional Agent-Native
  precision interaction.
- After cancelling the draft, focused-canvas `C` exposed the pin-placement
  hint and `Esc` removed it. Clicking a blank point opened Add comment; entering
  `Final comment parity QA` enabled Comment, and posting created an anchored
  marker and the corresponding thread in the Comments panel. Reloading the
  same deck preserved the marker and comment text.
- In the earlier exact-build replay of the same snapshot, an object comment was
  created from the selection toolbar, a reply was added, 👍 was added and
  displayed as `👍 1`, the root comment was edited, the thread was resolved and
  reopened, search matched and cleared, For you hid a self-only comment, All
  slides exposed the comment across slide navigation, and a slide-position pin
  was posted. These paths are covered by the focused comments suite as well as
  the browser state transitions.

The shared root causes addressed in this release-slot pass are:

- strict, persisted slide/object comment anchors with target text and relative
  coordinates;
- object-aware marker repositioning across resize, scroll, and canvas layout
  changes;
- deck/slide/thread-scoped action authorization for create, list, edit,
  resolve/reopen, delete, and reaction toggle;
- compare-and-swap emoji reaction buckets so two viewers do not silently lose
  each other's reactions;
- shared panel/pin composer semantics, keyboard ownership, focus-safe
  cancellation, thread actions, and localized labels;
- screen context exposing comment IDs, thread ancestry, target text, anchors,
  resolution, and reaction summaries to the agent; and
- the `DeckEditor` hook-order boundary and Google no-selection shortcut
  boundary found during live browser replay.

### Evidence boundary and remaining gaps

This is not a claim that every Slides interaction is globally 1:1. The
verified disposition is limited to the named comment subset and the broader
editor cases explicitly marked as browser-verified above. The following remain
open and are deliberately not called passed: two-user presence and concurrent
conflict/selection handoff; collaborator @mentions and action-item assignment;
advanced imported fixture coverage for tables, charts, media crop/mask, guides
and grid settings; direct external import/export round trips; and pixel-level
visual parity for every hover, focus, loading, and resolved-panel state. The
local Comments panel intentionally keeps Agent-Native styling and labels while
matching Google's interaction semantics. No deployment or beta health claim is
made by this ledger; that requires the post-merge monitoring workflow.

## Gap-closure replay — 2026-09-15

This pass runs on branch `steve8708/changes-8095` at the pre-fix working-tree
head `45ad3ed8ef58f50973ae090df31dd9e949082b2f`, with one local production
artifact server at `http://127.0.0.1:4174/` and the same 1280×720 viewport used
for the Google Slides oracle. The disposable local deck was
`Comment parity screenshot fixture`; the private Google reference remained
`Slides Comment Parity QA` and its baseline comments were not changed.

### Evidence and disposition

- Live local evidence passed for the source-added rail and editor paths:
  New slide, `Ctrl+M` insertion after the active slide, contiguous Shift-range
  selection, selected-set duplicate, one-step selected-block reorder,
  Tab/Shift+Tab canvas traversal, anchored comment/reply persistence across
  reload, and same-layout insertion. The measured input-to-visible values were
  878 ms, 1070 ms, 2421 ms (two-click range sequence), 1106 ms, 1239 ms,
  678 ms, 796 ms, and 292 ms respectively; these include the browser harness
  wait and are not intrinsic performance benchmarks.
- A confirmed product-owned bug was reproduced beside Google: `⌘/Ctrl+A`
  from an object-focused canvas cleared the local selection after the
  selection-only rerender, while Google selected all editable slide objects.
  Root cause was the content-reconciliation effect depending on the unstable
  `applyMultiSelection` closure; selecting an object changed that closure and
  caused the effect to consume an empty pending-resync value. The effect now
  keys only on `slide.content` and reads the latest callback through a ref.
  `SlideEditor.render-phase.test.ts` guards this boundary, and the focused
  interaction suite passes 10 files / 247 tests.
- Native `⌘/Ctrl+V` was attempted but the browser harness reported an empty
  virtual clipboard. This is an environment limitation, not a product
  disposition; native paste remains open for a seeded clipboard replay.
- The local screenshot fixture was intentionally left as disposable QA data;
  it is not shipped source and has not been called representative production
  content. No Google slide or baseline comment was deleted.

### Post-fix browser proof boundary

The fresh production artifact was reloaded at the matched 1280×720 viewport.
After a real pointer selection focused the canvas, object-focused `⌘+A` retained
all five selectable roots: the accessibility tree reported `5 selected`, the
selection chip was visible, and the DOM contained one multi-selection outline
covering the selected set. The click/key/state-capture replay measured 867 ms
including browser-harness wait time; it is not an intrinsic performance
benchmark. The before and after captures were shown inline in the task output;
the CUA harness exposes no filesystem screenshot path. This verifies the
specific select-all regression row, not the entire interaction matrix. Native
paste and all other rows explicitly left open above remain unverified, and the
unrelated Content docs working-tree edit remains untouched.

## Disposition rules

- `Implemented, verify` means the implementation and focused unit coverage
  exist; it is not a 1:1 claim until browser evidence is recorded.
- `Partial` means only the named subset is covered or the app intentionally
  differs and that difference still needs an explicit decision.
- `Open bug` means a concrete expected-vs-actual discrepancy with a named
  shared boundary. Fixes should add a focused regression test at that boundary.
