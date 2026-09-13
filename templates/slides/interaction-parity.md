# Slides interaction parity

This is the running desktop-editor evidence and disposition record for the
Google Slides interaction-parity effort. It records observed contracts and
reproduction targets; it does not claim that an area is 1:1 until a focused
test and a browser/editor check both pass.

Last audited: 2026-09-13

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

## Coverage matrix

| Surface                        | Google contract to exercise                                                                  | Current disposition       | Evidence / next action                                                                                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas selection               | Click selects; Shift/Cmd/Ctrl toggles; marquee selects; whitespace clears                    | Partial                   | Existing pointer/marquee paths. A Shift/Meta-click attempt did not visibly multi-select, but modifier delivery was inconclusive; rerun toggle, overlap, clear, and reload checks with a live editor                                                               |
| Object keyboard                | Duplicate, delete, nudge, Tab/Shift+Tab traversal, select-all                                | Partially implemented     | Browser: Cmd+D creates a third shape; Cmd+Z removes it, Cmd+Shift+Z restores it, and reload keeps it. Tab traversal, select-all, delete focus, and nudge remain open                                                                                              |
| Clipboard                      | Copy, cut, paste, duplicate with object and slide focus                                      | Partial                   | Duplicate shortcut verified separately; native copy/cut/paste, external clipboard formats, focus routing, and undo/reload remain open                                                                                                                             |
| Resize and rotate              | Eight resize handles; aspect-ratio modifier; circular rotate handle; Shift rotation snapping | Partially implemented     | Browser: southeast-handle drag by 28 px grows the shape by about 28 px per axis with fixed left/top; same-tab reload preserves exact CSS geometry. Translated mixed-selection rotation has focused matrix/translate tests; live rotation, modifiers, and group resize remain open                                     |
| Snapping and guides            | Object/canvas snapping; rulers, guides, grid toggle, modifier bypass                         | Partial                   | Snapping/bypass paths exist; ruler, guide, grid preferences, and modifier muscle memory remain open                                                                                                                                                               |
| Align and distribute           | Align 2+ objects; distribute 3+ objects                                                      | Implemented in code/tests | Geometry and toolbar callback coverage; browser verify dimensions, selection persistence, and undo/redo                                                                                                                                                           |
| Grouping                       | Group selected objects; group acts as one object; ungroup restores members                   | Partially verified        | Browser verified for a two-shape group: single-group selection, child click, group reload, ungroup reload, undo, and redo. Multi-object geometry, nested groups, stack-order tie behavior, and rotated ungroup in-browser remain open                             |
| Z-order                        | Bring/send front/back and one-step forward/backward                                          | Partially verified        | Browser: toolbar “Send to back” moved the overlapping duplicate to z-index 0 behind the original (1); Cmd+Z cleared the order, Cmd+Shift+Z restored it, and reload retained 0/1/2. Bring/front, one-step, pixels, equal-z peers, and keyboard/context remain open |
| Text editing                   | Single/double click entry, selection formatting, lists, Escape ownership                     | Partial                   | Rich-text and toolbar regression tests exist; browser muscle-memory and persistence pass remains                                                                                                                                                                  |
| Images and media               | Select, replace, crop/fit, position, drag/drop, external image paste                         | Partial                   | Image overlay/drop paths exist; crop, masking, external paste, and round trips need representative fixtures                                                                                                                                                       |
| Shapes, lines, tables, charts  | Insert, select, edit, style, move, resize, table cell actions                                | Partial                   | Shapes/tables are present; cover line endpoints, cell selection, charts, and advanced media in editor                                                                                                                                                             |
| Slide rail                     | Insert, duplicate, multi-select, reorder, delete, skip, grid/list view                       | Partial                   | Rail actions and shortcuts exist; verify multi-slide operations, keyboard focus, and persistence in editor                                                                                                                                                        |
| Layouts/themes/master behavior | Layout changes preserve editable objects and linked design-system tokens                     | Partial                   | Layout/design-system paths exist; Google master/theme equivalence versus intentional product behavior needs explicit disposition                                                                                                                                  |
| Comments/collaboration         | Comment pins, threads, presence, selection handoff                                           | Partial                   | Comment/presence paths exist; side-by-side two-user editing and conflict behavior remain unverified                                                                                                                                                               |
| Undo/redo                      | Object and slide edits undo/redo without clobbering remote/local state                       | Partial                   | Browser verified group and duplicate undo/redo; duplicate redo survives reload. Slide/deck mutation classes and remote-edit interaction remain open                                                                                                               |
| Zoom and pan                   | Zoom controls/shortcuts and canvas navigation remain selection-safe                          | Partial                   | Zoom controls exist; keyboard/pointer navigation and selection/scroll preservation remain open                                                                                                                                                                    |
| Import/export                  | PPTX/PDF/HTML/Google Slides round trips preserve objects and metadata                        | Partial                   | Existing preservation contract; use stable seeded simple/advanced fixtures and compare before/after render and metadata                                                                                                                                           |
| Agent-Native boundaries        | Selection/app-state, shared actions, persistence, reload and collaboration                   | Partial                   | Selection is published to app state; new group/rotation state has unit serialization coverage but not live reload evidence                                                                                                                                        |

## Repeatable case matrix

These fixture definitions and scenarios are a test plan, not evidence. Each
fixture must be created from the same PPTX in Google Slides and in the local
Slides app, then captured before any interaction. The two imports may mint
different object IDs; use labels, slide order, rendered geometry, and content
as cross-app identity, and record each app's IDs separately.

| Fixture | Stable starting content | Main coverage |
| ------- | ----------------------- | ------------- |
| Simple (2 slides) | Two overlapping rectangles, one ellipse, a free line, and two editable text boxes | Selection, focus, move/resize, copy/duplicate, text editing, undo/redo, basic slide-rail actions |
| Mixed (3 slides) | A cropped image with an overlapping shape; a 4×3 native table; a native two-series chart | Image crop/mask/style, cell selection and formatting, chart selection/editing, object overlays |
| Advanced (5 slides) | Rotated and translucent shapes; three group candidates plus an unselected peer; four uneven alignment targets; a table and chart; a second image with separate text and line | Local-frame transforms, group/ungroup, equal-z ordering, alignment/distribution, slide rail, mixed-media persistence |

For every scenario, capture the untouched state, exercise pointer and keyboard
paths, then the available modifier, context-menu, and inspector/menu paths. Check
the visible result and persisted deck state; undo once, redo once, reload, and
compare again. Where an app intentionally lacks a Google-only service feature,
record that boundary instead of treating absence as a geometry or editor bug.

| Case | Reproduction and Google Slides oracle | Cross-input paths | Persistence and regression oracle |
| ---- | ------------------------------------- | ----------------- | --------------------------------- |
| Selection and focus | On Simple slide 1, click each overlap target, toggle a second object with Shift and platform primary-click, marquee the pair, then click whitespace. Capture actual Google Slides selection and hit order; the help pages do not define every selection gesture. | Pointer click/drag, Shift/primary modifier, `Tab`/`Shift+Tab`, `Cmd/Ctrl+A`, `Escape`, context menu / `Shift+F10` | Local editor selection IDs match the selected root objects and are published to `slides-selection`; selection clears or returns to the editor's documented focus owner. Reload checks persisted objects, not a transient selection unless app state promises it. |
| Object move and snapping | Drag an object near another object's edge/center, then near a ruler guide and grid intersection. Guides snap by default; grid snapping is an explicit View setting. | Drag, Shift-constrained movement, platform guide-suppression modifier, View menu, keyboard nudge by Arrow and Shift+Arrow | Record final canvas coordinates, visible snap guides, and setting state. Undo/redo/reload must restore the same object geometry without moving sibling objects. |
| Resize and rotate | On Simple slide 1, exercise all eight resize handles; use Shift for aspect ratio and the platform center-resize modifier. On Advanced slide 1, drag the visible handle of a rotated object, then rotate from its handle. Google lists Shift rotation snapping to 15° and keyboard rotation at 1°/15° increments. | Pointer handles, Shift/platform modifiers, `Option+Shift+←/→` (1°), `Option+←/→` (15°) on Mac; corresponding Google shortcuts on the tested platform; inspector numeric fields | Compare local-frame anchors, opposite-edge stability, transform origin, angle, and rendered bounds. Cancel with Escape, commit, undo/redo, and reload. |
| Grouping and z-order | On Advanced slide 2, group non-adjacent members across the unselected peer, move/resize/rotate the group, then ungroup. Google documents Arrange → Group and order actions; selected-layer tie breaking must be observed, not inferred from docs. | Toolbar/context menu; Mac `⌘+Option+G` / `⌘+Option+Shift+G`, PC `Ctrl+Alt+G` / `Ctrl+Alt+Shift+G`; Mac `⌘+↑/↓` / `⌘+Shift+↑/↓`, PC `Ctrl+↑/↓` / `Ctrl+Shift+↑/↓` | Compare paint order and member geometry before/after group, ungroup, undo/redo, and reload. Include repeated preview updates and non-inline CSS transforms in the focused regression fixture. |
| Clipboard and duplicate | Copy, cut, and paste one object, a multi-selection, text inside edit mode, and a slide-rail selection. Duplicate with `Cmd/Ctrl+D`; compare drag-duplicate behavior with the host's platform modifier. | Native shortcuts, context menu, object/slide focus, modifier-drag, external plain-text paste, image paste when clipboard permission is available | New persisted object IDs are unique; styles, geometry, and z-order are preserved. Undo/redo must affect one logical operation; reload must preserve committed content and not resurrect a cut object. |
| Text editing and formatting | On Simple slide 2, enter text by double click, select a range, format only that range, change paragraph alignment/list state, then leave text editing with Escape. | Single/double click, caret and range selection, toolbar, context menu, `Cmd/Ctrl+B/I/U`, list/align shortcuts, keyboard focus | Verify rich-text HTML/readback, selected range, caret ownership, final keystroke persistence, undo/redo granularity, and fresh-load rendering. |
| Images and media | On Mixed slide 1 and Advanced slide 5, move/resize/replace an image; test crop, mask, fit, border, opacity/brightness/contrast, and reset. Use video only if an editable video source is available. | Pointer frame/crop handles, Insert menu, context menu, inspector/format options, drag/drop, external paste when permitted | Preserve intrinsic aspect ratio, source, crop, and mask independently. Read back after reload and round-trip. Mark media requiring an unavailable external account as blocked rather than passed. |
| Shapes and lines | Insert a shape and a line; edit endpoints, stroke/fill/transparency, line dash, and rotation; overlap the line with objects and move each endpoint. | Insert menu, pointer endpoints, keyboard selection/nudge, context menu, inspector/style controls | Compare endpoints and object transforms, not just the line's axis-aligned box. Verify style and geometry through undo/redo/reload and PPTX import/export. |
| Tables and charts | On Mixed slide 2, edit cells and test the documented 20×20 insertion limit, row/column insert/delete, gridline resize, table-corner resize, selected-cell fill and borders. On Mixed slide 3, select and edit the native chart. | Cell keyboard navigation, right-click cell menus, table handles, toolbar/inspector, chart selection and context menu | Verify cell values, row/column dimensions, border/fill styles, chart series/categories and editability after reload/import. Do not require Docs-only table sorting, pinning, or row/column dragging in Slides. |
| Slide rail | Insert a slide with the current layout and with a different layout; Shift-select multiple slides; duplicate, reorder, delete, skip, then switch filmstrip/grid view. | Rail pointer/context menu; Page Up/Down and slide-order shortcuts; `Shift+↑/↓`; `Cmd/Ctrl+↑/↓` and `Cmd/Ctrl+Shift+↑/↓` | Compare slide IDs and order, per-slide content/layout, skipped state, selection, thumbnails, undo/redo, and fresh load. Deletion must be undoable; skip must not delete. |
| Themes, layouts, and background | Change theme, change a slide layout, set one-slide background, then apply a background to the theme. Insert a template slide only as a distinct import path. | Slide/Layout menus, theme sidebar, background controls, context menu where available | Record which slides and inherited styles changed. Preserve editable freeform objects and intentional Agent-Native design-system tokens; document master/layout differences as product boundaries, not silent equivalence. |
| Comments and collaboration | Anchor comments to text, an image, and a slide; reply, mention a collaborator, filter open/resolved, resolve/reopen, and test reactions. Repeat with two editor identities for presence, concurrent edits, and selection handoff. | Toolbar/selection comment action, comment panel, comment keyboard shortcuts, pointer and keyboard navigation | Compare anchor target, thread/reply order, resolution state, and notifications where available. Verify concurrent writes do not clobber local edits; do not claim presence from a single-user run. |
| Viewport, undo/redo, and reload | Zoom in/out/reset, pan/scroll around a selected object, then apply representative object, text, slide, and theme edits. | Pointer wheel/trackpad, zoom controls, documented zoom shortcuts, keyboard focus movement | Selection and scroll behavior should match the reference capture; undo/redo must be scoped to one edit and not erase another object or remote change. Reload after each operation class and compare render plus action readback. |
| Import/export and agent boundary | Round-trip each fixture through PPTX; also exercise Slides PDF/HTML export and Google Slides conversion separately. For each UI edit, read the result through the Slides action surface; for each action edit, confirm the editor updates. | UI flow, export/import menus, `get-deck`/`view-screen` actions, navigation and application-state reads | Compare slide count/order, editable objects, text, images/crops, tables/charts, notes/animation metadata, and known ID remapping. A successful download or upload alone is not a fidelity pass. |

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
- The required workspace prep was attempted after the review fixes. The root
  formatter completed and Slides typecheck reported Done, but workspace tests,
  unrelated package typechecks, and the MCP registry guard failed on missing
  local dependency links and production-only environment configuration. The
  Core test lane stalled amid unrelated harness errors and was interrupted;
  the focused Slides tests above passed independently.
- `pnpm --filter slides typecheck` exited successfully; the framework also
  printed its existing production auth/database configuration diagnostics.
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

## Disposition rules

- `Implemented, verify` means the implementation and focused unit coverage
  exist; it is not a 1:1 claim until browser evidence is recorded.
- `Partial` means only the named subset is covered or the app intentionally
  differs and that difference still needs an explicit decision.
- `Open bug` means a concrete expected-vs-actual discrepancy with a named
  shared boundary. Fixes should add a focused regression test at that boundary.
