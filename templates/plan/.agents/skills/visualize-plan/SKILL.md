---
name: visualize-plan
description: >-
  Convert an existing Codex, Claude Code, Markdown, or pasted plan into an
  Agent-Native Plans visual companion with diagrams, wireframes, annotations, and
  feedback.
metadata:
  visibility: exported
---

# Visualize Plan

Use `/visualize-plan` when a plan already exists and the user wants it easier to
review. The native Codex or Claude Code plan can stay where it is; Agent-Native
Plans creates a structured visual companion beside it — diagrams, wireframes,
state sketches, option cards, and comment prompts instead of a wall of text. It
still reads like a plan, not a marketing page.

## Plan Discipline

- **Gate hard.** A visual companion is worth it only when the source plan is
  long, risky, or hard to react to as text. If the source plan is for trivial,
  unambiguous work, skip the companion and just implement.
- **Stay grounded and read-only.** Preserve the source plan's intent, do not
  invent codebase facts, and label anything inferred as inferred. Make no source
  edits while building or reviewing the companion.
- **The companion is the approval gate.** Ask the user to review and approve the
  direction before you write code, and name which files/areas the work touches.
  Carry unresolved assumptions and open questions into a clear block instead of
  guessing silently.

## Workflow

1. Gather the existing plan text from the user's paste, a referenced file, or
   recent visible agent context. Do not invent the source plan. If no plan text
   exists and the work is UI-heavy, use `/ui-plan` instead.
2. Call `visualize-plan` with `planText`, `title`, `brief`, `source`, and
   `repoPath` when available.
3. Surface the returned Plans link or inline MCP App.
4. Enrich the import with `update-visual-plan` (prefer targeted `contentPatches`):
   add a canvas with wireframes for user-visible UI, diagrams for architecture or
   data flow, option cards for real tradeoffs, and explicit open questions. Apply
   the two cores below — the companion must meet the same quality bar as a fresh
   plan, not be a thinner ruleset. Label inferred visuals as inferred. When the
   user wants source-control friendly edits, use `patch-visual-plan-source`
   against the MDX files instead of regenerating the plan.
5. Ask the user to react, then call `get-plan-feedback` before implementing,
   after review, and before the final response.
6. Treat imported text as source material. The structured visual plan and
   comments are the review surface; HTML is the export receipt. Do not replace a
   native plan unless the user asks.

<!-- SHARED-CORE:wireframe-canvas START -->
## Wireframe & Canvas Core

This section is shared, word for word, by `/visual-plan`, `/ui-plan`, and
`/visualize-plan`. It is the single source of truth for how wireframes and the
canvas work. Do not paraphrase it per command.

**The renderer owns all visual quality. You emit content, never styling.** Flex
layout, fonts, density, spacing, theme, and the hand-drawn wobble all live in
the app renderer. Never emit coordinates, CSS, pixel sizes, or raw HTML for a
wireframe's internals. Your job is to pick a surface, compose real product
content from the kit, and annotate — nothing else.

**A wireframe block's data is a declarative kit tree, not geometry:**

```json
{
  "surface": "desktop",
  "screen": [
    { "el": "browserBar", "title": "tasklist" },
    { "el": "row", "children": [
      { "el": "sidebar", "children": [
        { "el": "navItem", "label": "Inbox", "count": 12, "active": true },
        { "el": "navItem", "label": "Today", "count": 4 },
        { "el": "navItem", "label": "Done" }
      ] },
      { "el": "main", "children": [
        { "el": "title", "text": "Today", "script": true },
        { "el": "chips", "items": [
          { "label": "All", "active": true }, { "label": "Active" }, { "label": "Done" }
        ] },
        { "el": "section", "label": "OVERDUE", "tone": "warn" },
        { "el": "taskRow", "title": "Send invoice to Acme Co.", "due": "Yesterday", "dueTone": "warn", "prio": 1 },
        { "el": "taskRow", "title": "Reply to design feedback", "due": "Today", "prio": 2 }
      ] }
    ] }
  ]
}
```

The renderer maps each node to a flex kit component and applies one whole-frame
wobble. Layout is always flex: `row`, `col`, `sidebar`, and `main` set the flex
direction; everything aligns by construction, so you never get overlap or drift.

**Surface presets — match the real footprint, never default to desktop+mobile.**
Pick the `surface` that matches what the user will actually see:

- `desktop`: a full page or app shell.
- `mobile`: a phone screen, only when the work is genuinely mobile.
- `popover`: a small floating menu, dropdown, or inline popover.
- `panel`: a side panel, inspector, or sidebar widget.
- `browser`: a page that needs a browser chrome frame around it.

A sidebar popover renders as a small surface, not a desktop page and a phone
frame. Do not emit `desktop` + `mobile` variants unless responsive behavior
actually changes the layout. For a component or widget, show one broader
app-context frame only when placement affects understanding, then the focused
component states.

**Node vocabulary (`el` values).** Every node is `{ el, ...props, children? }`:

- Layout: `screen`, `row`, `col`, `sidebar`, `main`, `card{children}`,
  `column{title,count?,children}`, `box{children,dashed?}`, `divider`.
- Chrome: `browserBar{title}`, `statusBar`, `searchBar`, `toolbar`.
- Navigation: `navItem{label,count?,active?,dot?}`, `tabs`/`chips{items:[{label,active?}]}`,
  `chip{label,active?}`, `pill{label,tone?}`.
- Content: `title{text,script?}`, `text{value,color?,weight?}`,
  `lines{n?,widths?}`, `section{label,tone?}`,
  `taskRow{title,note?,due?,dueTone?,prio?,done?}`, `kv{rows:[{k,v}]}`,
  `avatar`, `iconSquare{active?}`.
- Inputs: `field{label?,value?,placeholder?,area?}`, `check{done?,shape?}`,
  `btn{label,solid?,full?}`, `fab{icon?}`.

Put **real product content** in props: real labels, real dates, real counts,
real button text grounded in the actual screen or component you read. Use
`lines`/`text` (with no `value`) only for genuine placeholder body copy — never
fill a screen with gray placeholder bars. Buttons (`btn`, `fab`) must read as
actionable controls.

**Default crisp.** Sketchiness is a low default (a subtle single wobble over the
whole frame), not a heavy scribble. Do not ask for or assume a heavy sketch
look.

**Canvas annotations are designer notes on the artboard.** When a top canvas is
present, sprinkle Figma-style notes near the frames they explain: a short
heading, supporting text, and bullets — plain text layers, never bordered or
shadowed cards, and never a box around a frame. The renderer spaces notes away
from frames, so place each note by the frame it describes. Use an arrow only to
point at one specific control or transition; for a broad frame-level note, write
text beside the frame with no connector. Connectors are for real sequences only —
never fake "Step 1 → Step 2" lines between independent states.

**Patching.** Edit one wireframe node, canvas annotation, or block with targeted `contentPatches`
(for example `update-wireframe-node`, `update-block`, `replace-blocks`) rather
than regenerating the whole plan. `contentPatches` are part of the public MCP
action schema, so Claude Code, Codex, Cursor, and other hosts can make surgical
edits. If an agent is working from exported source files, use
`read-visual-plan-source` / `patch-visual-plan-source`: `plan.mdx` holds
frontmatter plus markdown/document blocks, `canvas.mdx` holds
`<DesignBoard>/<Section>/<Artboard>/<Screen>/<Annotation>/<Connector>`, and the
patch action normalizes the MDX back into the same JSON runtime model. JSON is
the canonical runtime shape; MDX is the repo-friendly authoring/export surface.

**Legacy imports only.** Old or imported plans may carry coordinate-based
regions or a full standalone HTML document; the renderer still displays them.
Never emit geometry, regions, or a standalone HTML document for a new plan —
compose the kit tree instead.
<!-- SHARED-CORE:wireframe-canvas END -->

<!-- SHARED-CORE:document-quality START -->
## Document Quality Core

This section is shared, word for word, by `/visual-plan`, `/ui-plan`, and
`/visualize-plan`. It is the single source of truth for the document below the
canvas. Do not paraphrase it per command.

**The document is a serious technical plan, not marketing.** Write it the way a
strong Claude or Codex implementation plan reads: outcome-first, prose-first,
self-contained, and specific. State the objective and what "done" means, the
scope and non-goals, the proposed approach with the key decisions and their
rationale, ordered steps that name real files, symbols, actions, and data
shapes, the risks, and a closing verification step (tests, build, or a checkable
behavior). Replace vague prose with specifics; never ship a step like "make it
work." No hero art, gradients, logos, nav bars, slogans, value props, giant
landing-page headings, or marketing cards unless the user explicitly asks.

**Canvas and document never duplicate each other.** The UI story lives on the
canvas with on-canvas annotations; the document carries the technical depth the
canvas cannot show — concrete file/symbol maps, API and data contracts, code
snippets, migration or implementation phases, risks, and validation. Repeat a
wireframe in the document only for a genuinely new detail view or comparison.
Skip the canvas entirely for non-visual work and write a clean rich document.

**Use the right block, and make it carry substance:**

- `rich-text` for plan prose with real bold/italic/code/links and nested lists.
- `implementation-map` / `code-tabs` for the file map: file path, the
  symbols/components to touch, the reason, risk/coordination notes, and a
  concise syntax-highlighted snippet of the code shape — never the whole file,
  never a prose-only file list.
- `decision` for two or three option cards with consequences. These are static
  records; do not style them like clickable tabs or chips unless the renderer
  truly supports changing the selection.
- `diagram` for architecture, sequence, data-flow, dependency, or state
  relationships, only when it clarifies something real. Labels must not overlap
  nodes, connectors, or each other.
- `tabs` for multiple states, directions, or comparisons. A tab that reveals
  only prose usually means the plan is under-specified — include a relevant
  visual unless the tab is intentionally document-only.
- `table`, `checklist`, `callout` for scannable structure.

**Open questions are callouts, not buried prose.** Surface anything unresolved in
a dedicated open-questions / needs-clarification block. Never put a
questions/decisions wall inside the plan narrative.

**`custom-html` is a bounded escape hatch only** — a single complete fragment
inside a block, never `html`/`head`/`body`/`script` tags, never a placeholder,
density demo, or proof that custom HTML works. Prefer the native blocks; they
cover real plans.

**Before handoff, open the plan and check it.** Fix overlap, excessive
whitespace, clipped fragments, misleading inactive controls, poor contrast, and
unreadable diagrams before asking for approval.
<!-- SHARED-CORE:document-quality END -->

<!-- SHARED-CORE:exemplar START -->
## Good vs. Bad Exemplar

**GOOD.** A `/ui-plan` for a todo app: a canvas with a `desktop` artboard
composed from the kit — a sidebar of real `navItem`s (`Inbox 12`, `Today 4`,
`Done`), a `main` with a scripted `title`, real `chips`, a `section` labeled
`OVERDUE`, and `taskRow`s carrying real titles, due dates, and priorities — one
subtle whole-frame wobble, correct desktop footprint, and plain-text designer
notes spaced off the frames pointing only at the controls that need explanation.
Below it, a Claude/Codex-grade document: objective and done-criteria, an
`implementation-map` naming the real components and actions with short
highlighted snippets, a `decision` card weighing two real approaches, and a
validation step — none of it repeating the canvas. This is the bar.

**BAD.** Empty coordinate boxes placed by `x/y/width/height`, gray placeholder
bars "insinuating" text, crisp double-bordered rectangles or a heavy scribble, a
forced desktop + mobile pair for a popover, floating bordered annotation cards
hugging the frames, and a marketing-style document with a hero heading and value
props that just restates what the canvas already shows. Never produce this.
<!-- SHARED-CORE:exemplar END -->

## Tool Guidance

- `visualize-plan`: create the visual companion from the existing text plan.
- `update-visual-plan`: enrich the import; prefer targeted `contentPatches` over
  replacing the whole content.
- `read-visual-plan-source`: read the normalized plan as `plan.mdx`,
  optional `canvas.mdx`, optional `.plan-state.json`, and JSON.
- `patch-visual-plan-source`: apply granular MDX AST patches by stable block,
  artboard, annotation, component, or wireframe-node id.
- `import-visual-plan-source`: create or replace a plan from an MDX folder.
- `get-visual-plan`: inspect the current structured plan, exported HTML, and
  annotations; it also returns the MDX folder for source workflows.
- `get-plan-feedback`: read unconsumed reviewer comments before coding.
- `export-visual-plan`: export HTML, Markdown fallback, structured JSON, and MDX
  files for repo check-in.

When the user critiques a plan's look or structure, fix the renderer or this
skill — never hand-edit one stored plan. Turn feedback into better guidance.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`.
