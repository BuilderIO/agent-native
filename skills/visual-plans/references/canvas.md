# Canvas & artboard placement — single source of truth

This file is the canonical guide for how the visual-plan canvas works: artboard
placement, lane layout, annotations, patching, and the legacy kit tree. Read it
in full before authoring or editing any canvas/artboard content; do not author
canvas layouts from memory or paraphrase these rules per mode.

<!-- SHARED-CORE:canvas-surface START -->

**The coordinate rule.** The `surface` locks each artboard's footprint and
aspect — never set artboard width/height and never use coordinates inside the
wireframe HTML; board-level artboard `x`/`y` IS allowed when it creates clear
lanes. Let canvas auto-placement handle simple one-row boards.

**Lay out mixed canvases in lanes.** When a canvas contains broad browser /
desktop frames plus compact `mobile`, `popover`, or `panel` surfaces, do not put
everything in one horizontal strip. Use board-level artboard `x`/`y` to reserve
lanes with generous empty space: main flow on one row, compact surfaces in their
own column or row, and loading/error states in a lower row. Keep at least 96px
between rendered artboard rectangles plus room for annotation gutters. Connect
only neighboring steps; never draw a long connector that skips across unrelated
frames. Before handoff, inspect the top canvas at default zoom and move any
frame whose label, connector, or annotation crosses another frame.

**Canvas annotations are designer notes on the artboard.** When a top canvas is
present, sprinkle Figma-style notes near the frames they explain: a short
heading, supporting text, and bullets — plain text layers, never bordered or
shadowed cards, and never a box around a frame. The renderer spaces notes away
from frames, so place each note by the frame it describes. Use an arrow only to
point at one specific control or transition; for a broad frame-level note, write
text beside the frame with no connector. Connectors are for real sequences only —
never fake "Step 1 → Step 2" lines between independent states.

**Do not create overlapping annotations.** Anchor each ordinary note to the
frame it explains with `targetId` + `placement` (top/right/bottom/left), and
omit `type` or use `type: "note"`. The renderer parks notes in a gutter beside
the frame and lays them out automatically. Do not use `type: "callout"`,
`type: "text"`, `type: "arrow"`, x/y, or points for ordinary notes; those are
freeform review-markup layers and must be reserved for intentional markup in
open canvas space. Reserve arrows for a note that must point at one specific
control inside a frame; a note that simply sits beside its frame needs no arrow.

**Patching.** Edit one wireframe, canvas annotation, diagram, or block with targeted `contentPatches`
(for example `patch-wireframe-html`, `patch-diagram-html`, `update-block`,
`replace-blocks`, `update-canvas-annotation`) rather
than regenerating the whole plan. `contentPatches` are part of the public MCP
action schema, so Claude Code, Codex, Cursor, and other hosts can make surgical
edits. If an agent is working from exported source files, use
`read-visual-plan-source` / `patch-visual-plan-source`: `plan.mdx` holds
frontmatter plus markdown/document blocks, `canvas.mdx` holds
`<DesignBoard>/<Section>/<Artboard>/<Screen>/<Annotation>/<Connector>`, and the
patch action normalizes the MDX back into the same JSON runtime model. JSON is
the canonical runtime shape; MDX is the repo-friendly authoring/export surface.
In the browser, humans edit `rich-text` prose inline; agents should still use
`update-rich-text` content patches or source patches for prose, and use
comments/structured patches for canvas, artboard, wireframe, and diagram edits.

**Never emit a titled artboard with no interior wireframe content.** Every artboard
you place on the canvas must carry an `html` wireframe or reference a wireframe
block via `blockId`; when using `blockId`, the referenced `wireframe` /
`legacy-wireframe` block must remain in the plan. If you remove a duplicate
wireframe from the document body, first move its `data` inline onto the
corresponding `content.canvas.frames[*].wireframe` / `legacyWireframe`. A
label-only frame or a frame pointing at a deleted block renders empty and is
rejected at parse time. If you only have a title, write it as a section header or
annotation, not an empty artboard.

**UI mockups belong in the top visual review area.** Static UI/product visuals
live on the canvas; multi-step UI flows get both canvas wireframes and a
prototype. When the user asks for a mockup, UI state, loading state, layout,
screen, or visual comparison, make the canvas the primary home for that static
visual. When the user asks for a prototype or the plan contains a sequence the
reviewer must feel, keep the canvas artboards and add `content.prototype` so the
top surface shows Wireframes / Prototype tabs. Architecture/code diagrams stay
inline in the document (the SKILL.md Visual Surface Choice section owns that
rule) unless the user explicitly asks for a spatial board. Document blocks
can explain, compare, or map implementation, but they should not host the
primary UI mockup or prototype just because `custom-html`, screenshots, or prose
are easier to produce. If the canvas/prototype surface cannot represent the
requested UI fidelity, still keep the closest top-surface representation and
call out or extend the needed renderer capability. A skeleton/loading mockup
also lives in a canvas artboard — never move a mockup out of the canvas.

**Legacy kit tree.** Older plans set a `screen` array of `{ el, ...props }` kit
nodes instead of `html`; the renderer still accepts and displays it, but new
plans emit `html`. Do not author fresh kit-tree screens - write the HTML mockup
instead. Likewise, old or imported plans may carry coordinate-based regions or
free-float x/y on notes; those are legacy escape hatches the renderer still
shows but you must never produce. The gutter parks notes by `targetId` +
`placement`, and the coordinate rule at the top of this file governs all
new-plan placement.

<!-- SHARED-CORE:canvas-surface END -->
