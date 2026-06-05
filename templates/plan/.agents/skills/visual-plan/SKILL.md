---
name: visual-plan
description: >-
  Use Agent-Native Plans when coding-agent work needs an interactive structured
  plan document with diagrams, wireframes, mockups, prototypes, annotations,
  and comments.
metadata:
  visibility: exported
---

# Agent-Native Plans

Agent-Native Plans is structured visual planning mode for coding agents. Build
the plan you would normally write in Markdown, but as a scannable document with
editable blocks mixed in: an optional pan/zoom wireframe canvas on top and a
Notion-like technical document below. The user reacts to visuals first and reads
prose only where it helps.

`/visual-plan` is the canonical command and the main entry point. Use `/ui-plan`
when the work is primarily product UI and review should start with the screens.
Use `/visual-questions` to run a visual intake form first. Use `/visualize-plan`
to turn an existing Codex, Claude Code, Markdown, or pasted plan into a visual
companion.

## When To Use

Create a visual plan when work is multi-file, ambiguous, long-running, risky, or
UI-heavy, when architecture / data flow / UI direction / options / open
questions would be clearer visually, or when the user needs to react to a
direction before you implement.

## Plan Discipline

- **Gate hard.** A polished visual plan is the most expensive plan form; only
  invest when a wrong direction is costly. Skip it for trivial, unambiguous work
  — typos, one-line fixes, a single well-specified function, anything whose diff
  you could describe in one sentence — and just make the change. Never pad a plan
  with filler and never ship a single-step plan.
- **Research before you draft.** Read the real files, actions, schema, and
  patterns first; name actual files, symbols, and data shapes instead of
  inventing them. Check existing `actions/` before proposing endpoints and prefer
  named client helpers over raw fetch. Delegate wide exploration to a sub-agent.
- **Planning is read-only.** Make no source edits while building or reviewing the
  plan. Start editing only after the user approves the direction.
- **Clarify vs. assume.** Do not ask how to build it — explore and present the
  approach and options in the plan. Ask a clarifying question only when an
  ambiguity would change the design and you cannot resolve it from the code; batch
  2-4 high-leverage questions before finalizing. Otherwise state the assumption
  explicitly and proceed, and put anything unresolved in an open-questions block.
- **The plan is the approval gate.** After surfacing it, ask the user to review
  and approve before you write code, and name which files/areas the work touches.
  Presenting the plan and requesting sign-off is the approval step — do not ask a
  separate "does this look good?" question.
- **The document is the source of truth, not the chat.** When scope shifts,
  update the plan with `update-visual-plan` rather than only changing course in
  chat, and re-read the approved plan before major steps.

## Core Workflow

1. Call `create-visual-plan` with the title, brief, source, repo path, and
   structured `content` blocks.
2. Compose the canvas from the kit and write the document with native blocks
   (see the two cores below). Skip the canvas for non-visual work.
3. Surface the returned Plans link or inline MCP App and ask the user to review.
4. Call `get-plan-feedback` before editing, after review, after any long pause,
   and before the final response.
5. Apply changes with `update-visual-plan`, preferring targeted `contentPatches`.
   When the user wants source-control friendly edits, use
   `patch-visual-plan-source` against the MDX files instead of regenerating the
   plan.
6. Export with `export-visual-plan` only when the user wants a shareable receipt
   or repo-check-in artifacts.

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

- `create-visual-plan`: start one structured visual plan per agent task/run.
- `create-ui-plan`: start a UI-first plan when the work is primarily product UI.
- `create-visual-questions`: run a visual intake form before planning.
- `visualize-plan`: build a visual companion from an existing text plan.
- `update-visual-plan`: revise content, status, or comments; prefer
  `contentPatches` over regenerating the whole plan.
- `read-visual-plan-source`: read the normalized plan as `plan.mdx`,
  optional `canvas.mdx`, optional `.plan-state.json`, and JSON.
- `patch-visual-plan-source`: apply granular MDX AST patches by stable block,
  artboard, annotation, component, or wireframe-node id.
- `import-visual-plan-source`: create or replace a plan from an MDX folder.
- `get-visual-plan`: read the current structured plan, exported HTML, and
  annotations; it also returns the MDX folder for source workflows.
- `get-plan-feedback`: read unconsumed human feedback. Use it frequently.
- `export-visual-plan`: export HTML, Markdown fallback, structured JSON, and MDX
  files for repo check-in.

When the user critiques a plan's look or structure, fix the renderer or this
skill — never hand-edit one stored plan. Turn feedback into better guidance.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`. Do
not put shared secrets in skill files.
