---
name: slide-editing
description: >-
  Edit individual slides, including content formatting, HTML styling, and
  bounded source and visual-fidelity checks. Use when changing an existing
  slide rather than creating a new deck.
---

# Slide Editing

## Source-backed slides

Generated Slides 2 slides store canonical React in `sourceTsx`; `content` is a
derived script-free preview. Read `get-slide-source` before a source edit and
save with `update-slide-source`, passing the returned `revision` and
`sourceHash`. Use its source-located `edits` for targeted changes or a complete
`sourceTsx` replacement for a broad rewrite. A stale revision/hash is a
conflict: re-read and reapply the edit. Never write generated source slides
through `update-slide` or `patch-deck` HTML fields, because that would leave the
preview and source inconsistent.

After a successful save, call `get-slide-source` and confirm its source,
revision, and hash match the update result before claiming the edit persisted.
An update receipt with `changed: false` means the requested source and derived
preview already matched, so no revision was created. If a save returns a
conflict or its response is lost, read the current source before retrying. If
the intended source is already present, treat the write as recovered; otherwise
reapply the edit to the latest source with its current revision and hash. Never
replay stale arguments blindly.

The editor's in-session Undo/Redo and saved deck history are separate. Source
updates snapshot the deck before writing, subject to the history's coalescing
cadence. Use `restore-deck-version` to restore a saved deck version; that action
also snapshots the current deck first so the restore is reversible.

The source renderer bundles bounded React source into a Worker and renders it
inside the opaque-origin sandbox. Keep source within the `create-deck` skill's
import, CSS, and asset limits. `Steps`/`Step`, `MorphElement`,
`useSlidePageNumber()`, `useIsActivePage()`, `cssVarsToString`, and static
`design`, `meta`, and transition exports are supported; effects and event
handlers do not provide client-side behavior. `cssVarsToString` returns bounded
text and does not enable runtime CSS injection. The `create-deck` skill
documents the exact source contract and static Page[]/notes/transition mapping.

The Slides 2 editor PDF and editable PPTX exports can render the Worker
artifact in the sandbox. The PPTX menu first calls the `export-pptx` action;
when a source-only slide returns `source_runtime_export_required`, it renders
the slides with `get-slide-render` and uses the browser DOM-to-PPTX builder.
HTML and Google Slides exports still require a static HTML preview and return
`source_runtime_export_required` when a source slide has none. The public
shared viewer shows an explicit capability state for source-only slides; it
does not have viewer authorization to request the Worker artifact by share
token.

## Source-backed object transforms

Use `transform-slide-objects` for source-backed object insertion, duplication,
deletion, and canvas arrangement. Call `view-screen` first; for duplicate or
delete, map the one current selected object's `sourceLine` and `sourceColumn` to
`target: { line, column }` only when `sourceSelectionStatus` and
`sourceTargetStatus` report `current`. Then call `get-slide-source` for that
deck and slide and pass its `revision` and `sourceHash` as `expectedRevision`
and `expectedSourceHash`. `insert` supports text, rectangle, ellipse, and line
objects, with optional 1920x1080 canvas bounds; it returns the created object ID
and source locator. `duplicate` returns the cloned source locator and remaps a
static ID when the object was inserted by the editor. Duplicate and delete
require one exact current source locator for a root element or direct JSX child.
Duplicate rejects custom or dynamic IDs, spread attributes, grouped objects,
and other uncertain subtrees. Delete removes the selected child, or replaces
the selected root with a blank canvas. Insertion uses the default slide canvas
layer.

The geometry operations are move, resize, rotate, align, distribute, group,
ungroup, and z-order. Selected geometry targets must share a JSX parent.
Geometry operations require static inline styles with absolute positioning and
numeric pixel bounds; grouping and z-order also require adjacent objects with
stable `data-slide-object-id` values. On a stale selection or source conflict,
refresh `view-screen` and `get-slide-source`, rebuild the operation from current
locators, and retry; do not replay stale coordinates or revision tokens. Read
the source back after a successful operation.

## Slides 2 visual controls

For source-backed visual edits, use `view-screen` to confirm the active slide and
selection, then read with `get-slide-source` and save through
`update-slide-source` using its returned revision and source hash. Keep React
source out of the legacy HTML fields on `update-slide` and `patch-deck`.
When `view-screen` reports a current `selectedTextRange`, pass its source
line/column, UTF-16 start/end offsets, and `expectedText` as `prevText` to
`update-slide-source` with a `set-text-range-style` edit. If the range is absent
or stale, reselect the text or reread the current source before editing.

For Undo, Redo, or Save in the visual editor, use the current
`view-screen` `Visual editor draft` identity with `control-slide-editor`, then
call `view-screen` again to confirm the one-shot command result. The editor
checks the active tab, editor session, history version, and saved source
revision/hash before applying it. Tab-scoped editor state is a command target,
not deck authorization; the action separately checks editor access.

| Control | Behavior |
| --- | --- |
| Preview / Edit | Preview hides the slide rail and editing overlays, closes the inspector, and restarts the active source slide at its first build step. Click, Space, Right/Down, or PageDown advances builds before moving to the next slide; click, Left/Up, or PageUp moves backward through builds before moving to the previous slide. Escape returns to Edit. Edit restores the inspector state from before Preview unless the inspector was toggled with `i` while previewing. |
| `i` | Show or hide the inspector. It is ignored while typing, composing, or focused on an editor control. The shortcut also works in Preview. |
| Canvas selection | Click an object to select it; Shift-click toggles its membership. Drag empty canvas to replace the selection with intersecting objects, or click empty canvas to clear it. |
| Cmd/Ctrl+A | Select all objects on the active slide. It is ignored while commenting, typing, or composing; while overview, command menu, asset browser, or image crop is open; and when focus is on editor controls, menus, or dialogs. |
| Cmd/Ctrl+S | Save pending source edits. Shift or Alt disables this shortcut. |
| Arrow-key editing and navigation | With the canvas focused, arrows nudge selected editable objects by 1 px, or 10 px with Shift. Otherwise, Left/Up moves to the previous slide and Right/Down to the next; PageUp/PageDown move previous/next, Space moves next, and Home/End jump to the first/last slide. |
| Shift and Alt while dragging | Shift constrains a move to its dominant axis, preserves the aspect ratio while resizing, and snaps rotation to 15-degree increments. Alt temporarily bypasses Smart Guides during a move. |
| Align and Smart Guides | For multiple objects, align to either the selection bounds or slide; one object aligns to the slide. Smart Guides starts on and snaps object edges and centerlines to other objects and the slide within a scale-adjusted 6 CSS px threshold. Toggle it in Arrange; Alt bypasses it for one move. |

The remaining HTML instructions in this skill apply to legacy or imported
content-backed slides. Their canvas follows the saved aspect ratio: 16:9 is
960x540, 1:1 is 1080x1080, 9:16 is 540x960, and 4:5 is 864x1080.

## Read before

Read a reference with `docs-search --slug "skill-slide-editing--references-<file>"`,
for example `skill-slide-editing--references-animations`.

| Situation | Read |
| --- | --- |
| Changing only colors, borders, shadows, or backgrounds, or matching every slide to one slide's look | `references/restyling.md` |
| Adding, changing, or removing click-to-reveal animations | `references/animations.md` |
| Adding, moving, duplicating, or restyling hand-placed text boxes and other freeform objects | `references/freeform-objects.md` |
| Adding or editing a video | `references/video.md` |

## Legacy HTML wrapper and styling

These wrapper instructions apply to imported and legacy content-backed slides.
Their outer `.fmd-slide` div carries the semantic `--deck-*` contract; source-
backed React pages render through the Worker and do not use that HTML wrapper.
With a design system linked, map `--deck-*` to `--ds-*`. Without one, write
literal values: the legacy renderer publishes only `--ds-bg` for unlinked decks,
so any other `var(--ds-*, ...)` resolves to its fallback.

Keep one deck-level contract: the same canvas, type pairing, palette, and
accent on every slide, varying composition rather than theme. Never alternate
light and dark slides or add a one-off font or palette unless asked. For polish
or "make it beautiful", read `slide-design`; a linked system's tokens still win.

## Updating legacy or imported HTML slides

Use this procedure only for content-backed HTML slides; follow the source-backed workflow above for `sourceTsx`.

1. Call `view-screen` for the active deck, slide ID, HTML, and any
   `slides-selection` target. The user navigates and reselects between turns:
   on any turn that says this, here, that slide, or the selected one, call
   `view-screen` again and never reuse a previous turn's slide ID or
   selection. If nothing is selected or the target is unclear, ask which slide.
2. When the edit changes facts, brand language, or layout, follow
   `creative-context` first. If retrieval yields a new context pack, keep its
   `contextPackId` with the deck provenance; existing HTML is not proof of
   which source version shaped it. Keep an approved native template or
   component when it fits; generate new structure only when the corpus is
   empty.
3. Write with `update-slide`: `deckId`, `slideId`, and ordered `edits` (exact
   replace, insert before/after, replace between markers, regex). Edits apply
   atomically under the deck lock, so one failed edit writes nothing.
   - **Selected text:** if `view-screen` returns an exact `selectedText` range,
     send one literal replace with the selected text as `find` and
     `expectedMatches: 1`. Use `selectionSlideId` and
     `selectionSlideContentHash` when present (the selection can be on another
     slide); otherwise `currentSlideId` and `currentSlideContentHash`. Never
     pair a `selectionSlideId` with the current slide's hash. Skip `get-deck`, `fullContent`, and layout-fit waits.
   - **Slides you wrote this run:** you already hold their HTML, so send
     `edits` directly (one `patch-deck` with `patch-slide` edits for several
     slides) without re-reading. Read with `get-deck` only if an edit fails to
     match or the write is rejected as stale; someone may have edited it since.
   - **Otherwise** (truncated, ambiguous, split by markup, or structural): call
     `get-deck` with that `slideId` (`compact=false` for full HTML, plus
     `format=true` for code-style work) and use its `contentHash` as
     `baseContentHash`.
   - Use `fullContent` only for an intentional full rewrite, never to make a
     small change. `format=true` persists readable line breaks.
4. Read back with `get-deck` (or a thumbnail's `.slide-content`
   `textContent`), never `document.body.innerText`: thumbnails use
   `content-visibility: auto`, so their text is empty in a hidden tab, and the
   canvas shows only the selected slide.
5. For factual edits, check changed text against the source: quote, speaker,
   date, metric, and uncertainty status. Visual similarity is not source
   fidelity.

Never write deck rows directly or add raw full-deck writes. Browser/editor code enqueues granular
operations through `patch-deck` / `DeckContext.tsx` instead of replacing the
whole deck JSON.

Report only what writes returned. `patch-deck` lists changed slides in
`updatedSlideIds` and byte-identical ones in `unchangedSlideIds`; an unchanged
slide was not restyled. `update-slide` fails with `slide_edit_noop`, and both
reject a batch where nothing changed, so re-read and send different content
instead of describing changes that did not land.

## Fit and layout checks

The `create-deck` Fit budget applies: on 16:9 with `64px 80px` padding the
content area is 800x412px, so use at most two title lines, three short bullets
or cards, and two or three items per column. When an edit adds or lengthens
text, redo the height arithmetic and split the slide instead of shrinking.
Body text stays at least 16px. Never hide overflow with zoom,
`transform: scale()`, clipping, or scroll; reducing explicit padding is allowed.

After all edits, call `get-layout-overflows` once, and once more only after
repairing a measured overflow. It reads the open editor's latest measurements
and cannot trigger new ones, so repeating it this turn changes nothing. If
status is unknown, name the unmeasured slide numbers and IDs and never claim
the deck fits.

## Contrast

Run `audit-contrast` as the last step of any turn that created or changed
slides (after layout repairs, right before the final response) and whenever
readability or accessibility comes up. If the deck is not open in the editor,
say contrast was not checked.

Fix failures in one pass by adjusting the role (`--deck-muted`, `--deck-ink`, a
surface), not one element's hex. Replacement colors must fit the theme:

- Design system linked: pick a passing color from its palette
  (`get-design-system`). If none passes, keep the token and report it.
- No design system: reuse a deck color, or shift the failing color's lightness
  while keeping its hue.

Never add an unrelated hue to pass. Audit once more, then report what remains;
re-audit once if slides come back skipped as `stale-render`. Skipped slides and
unverified text (over images, gradients, or effects) were not checked: name
them, and do not call the deck accessible or those slides fine.

## Flow layout and the editor

Keep generated flex and grid content in normal flow; create a deliberate
freeform object instead of absolute-positioning a layout child to make it
draggable. The editor presents flow content as flat objects the way Google
Slides does, so write markup that maps cleanly:

- A card is one painted box (background, border, or shadow on a single element)
  that owns its text. Never stack separately positioned text over a card
  background.
- Text containers, including `.fmd-text-box`, have no fixed `height`
  (`min-height` only for a deliberate minimum), so text grows instead of
  overflowing.
- Never write `contain` or `contain-intrinsic-size`; they break the editor's
  measuring and the PPTX export.
- No inline `<svg>`; the sanitizer removes it. Use styled divs or an `<img>`.
- Keep nesting shallow. Unpainted wrappers with no direct text (grid rows,
  columns) are fine; the pointer skips them.
- Ids belong to freeform objects only. Never stamp `data-slide-object-id` on a
  flow region: any id marks an object freeform and `export-pptx` rejects it.
  Preserve existing ids when rewriting a slide, and never save runtime
  `data-builder-id` values.
- An empty hidden `.fmd-layout-spacer[data-slide-layout-spacer-for="ID"]`
  reserves the flow slot of a hand-moved object. Keep it while its owner
  exists and delete both together.
- Keep the empty `<span data-slide-number></span>` and
  `<span data-slide-total></span>` tokens when restyling or rewriting a footer.
  They are empty in the saved HTML on purpose; never type digits over them.
- Use `fmd-img-placeholder` divs whose text names the content to show (see
  `create-deck` `references/slide-templates.md`) for diagrams, charts, and
  photos, then generate real images; never rebuild complex visuals in HTML/CSS.

Slide writes can return `hygieneWarnings` (inline svg and other markup the
sanitizer strips, typed page numbers, fixed px heights on text, `contain`,
stacked absolute text, deep nesting, tiny text). Fix them with `update-slide`
before finishing; a missing field means the lint found nothing.

## Skipping slides

A `patch-deck` `patch-slide` with `skipped: true` hides a slide from
Present/Presenter without deleting it; `skipped: false` restores it. The rail's
right-click Skip slide does the same.

## Transitions

Slide transitions (type and speed, Google Slides catalog) are set with the
`patch-slide` op of `patch-deck`, or with its `add-slide` op on creation. Read
`references/transitions.md` before changing them.
