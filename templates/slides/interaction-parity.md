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

- The matrix/translate rotation repro now passes in the 127-test focused
  interaction + marquee run. Standalone Slides TypeScript checking and
  `guard:no-silent-coercion` pass.
- The full local guard sweep still cannot complete because the worktree lacks
  the root `ajv` link required by `guard:mcp-registry`. CI also timed out once
  in the unrelated `generate-image-api` test; the exact test passed when run
  alone locally. The next PR CI run remains the merge gate.
- No new browser evidence was collected for rotation. Google Slides sign-in,
  representative side-by-side deck recreation, and all previously listed
  partial/open interaction areas remain outstanding; this matrix does not
  claim 1:1 parity.

## Disposition rules

- `Implemented, verify` means the implementation and focused unit coverage
  exist; it is not a 1:1 claim until browser evidence is recorded.
- `Partial` means only the named subset is covered or the app intentionally
  differs and that difference still needs an explicit decision.
- `Open bug` means a concrete expected-vs-actual discrepancy with a named
  shared boundary. Fixes should add a focused regression test at that boundary.
