---
name: visual-plan
description: >-
  Use Agent-Native Plans when coding-agent work needs an interactive structured
  plan document with inline diagrams, implementation maps, optional UI/product
  wireframes or prototypes, annotations, and comments.
metadata:
  visibility: exported
---

# Agent-Native Plans

Agent-Native Plans is structured visual planning mode for coding agents. Build
the plan you would normally write in Markdown, but as a scannable document with
editable blocks mixed in: inline diagrams, implementation maps, code previews,
open questions, and an optional top visual review area (wireframe canvas, live
prototype, or both in tabs). Architecture, backend, data, and refactor plans
usually start in the document with local diagrams near each claim. UI and product
plans should still start with the top canvas/prototype when screens or behavior
are what the user needs to review.

`/visual-plan` is the canonical command and the main entry point. Use `/ui-plan`
when the work is primarily product UI and review should start with the screens.
Use `/prototype-plan` when review should start with a functional live prototype.
Use `/plan-design` when review should start with full-fidelity branded design.
Use `/visual-questions` only when the user explicitly wants a visual intake form
before planning. When a Codex, Claude Code, Markdown, or pasted plan already
exists, `/visual-plan` uses that source plan as the starting point and builds
the review surface from it instead of starting over.

## When To Use

Create or adapt a visual plan when work is multi-file, ambiguous, long-running,
risky, or UI-heavy, when architecture / data flow / UI direction / options /
open questions would benefit from inline diagrams or structured blocks, when the
user needs to react to a direction before you implement, or when an existing text
plan needs a richer review surface.

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
- **Preserve existing plans.** If the user pasted, referenced, or already has a
  Codex / Claude Code / Markdown plan, treat it as source material. Preserve its
  intent, do not invent codebase facts, label inferred visuals as inferred, and
  build the visual review structure around the plan the user already has.
- **Planning is read-only.** Make no source edits while building or reviewing the
  plan. Start editing only after the user approves the direction.
- **Clarify vs. assume.** Do not ask how to build it — explore and present the
  approach and options in the plan. Ask a clarifying question only when an
  ambiguity would change the design and you cannot resolve it from the code; use
  the host agent's normal ask-user-question flow and batch 2-4 high-leverage
  questions before finalizing. Do not call `create-visual-questions` from
  `/visual-plan`; keep any answerable follow-up inside the plan itself as a
  bottom `question-form` Open Questions block. Otherwise state the assumption
  explicitly and proceed, and put anything unresolved in an open-questions block.
- **The plan is the approval gate.** After surfacing it, ask the user to review
  and approve before you write code, and name which files/areas the work touches.
  Presenting the plan and requesting sign-off is the approval step — do not ask a
  separate "does this look good?" question.
- **The document is the source of truth, not the chat.** When scope shifts,
  update the plan with `update-visual-plan` rather than only changing course in
  chat, and re-read the approved plan before major steps.

## Core Workflow

1. Follow the host agent's normal planning flow: inspect the codebase, delegate
   wide exploration when useful, gather the info needed, and ask native
   clarifying questions as needed before generating the plan. If a source plan
   already exists, gather its exact text from the user's paste, a referenced
   file, or recent visible agent context; do not invent source text.
2. Decide whether the plan needs a top visual surface with the rules below, then call
   `create-visual-plan` with the title, brief, source, repo path, and structured
   `content` blocks. When a source plan already exists, pass it as `planText`
   and preserve the original plan's intent while adding structured review
   content.
3. Compose or enrich any top UI/product visual surface from the kit and write the
   document with native blocks (see the cores below). Keep the document close to
   the Markdown plan the agent would normally output, or to the existing plan
   when one was provided. For architecture, backend, refactor, API, data-model,
   migration, or code plans, usually omit `content.canvas` and
   `content.prototype`; put `diagram`, `mermaid`, `data-model`, `file-tree`,
   `implementation-map`, `code-tabs`, and `annotated-code` blocks directly next
   to the relevant prose. Skip the top visual surface for non-visual work.
4. Surface the returned Plans link or inline MCP App and ask the user to review.
   Always include the actual URL in chat so the next step is a click in CLI or
   other text-only hosts. When the host exposes an embedded browser/preview panel
   and a tool can open arbitrary URLs there, open the returned plan URL
   automatically for convenient review; do not rely on this as the only handoff.
   Treat that browser open as a convenience and smoke test, not as the access
   model. Plans should load out of the box for the local agent and local browser
   session; if a signed-in embedded browser cannot read a local plan that an
   anonymous/tool check can read, fix the app/action ownership or access path
   rather than patching one plan by hand.
5. Call `get-plan-feedback` before editing, after review, after any long pause,
   and before the final response. Treat `anchorDetails`, resolver intent, recent
   review events, and any focused screenshots from browser handoff as the source
   of truth for exactly what changed and exactly what each comment points at.
6. Apply changes with `update-visual-plan`, preferring targeted `contentPatches`.
   When the user wants source-control friendly edits, use
   `patch-visual-plan-source` against the MDX files instead of regenerating the
   plan.
7. Export with `export-visual-plan` only when the user wants a shareable receipt
   or repo-check-in artifacts.

## Visual Surface Choice

Choose the surface before creating the plan or after reading the source plan. Do
not add visual chrome by default:

- **No visual surface** for architecture-only, backend-only, data migration,
  copy-only, or otherwise non-visual plans. Do not use the top canvas for
  architecture diagrams, dependency maps, file plans, API contracts, or
  data-flow-only reviews. Use a strong document with local inline diagrams
  only when relationships need a visual explanation, usually one spatial diagram
  per recommendation or decision. Prefer grouped regions, layers, quadrants,
  matrices, or before/after panels over a single-axis chain unless the
  relationship is truly sequential.
- **Canvas only** for one static screen, a before/after comparison, a component
  state, a small popover, or a visual direction that does not require clicking.
  Put those wireframes in `content.canvas` and omit `content.prototype`.
- **Canvas + prototype** for multi-step UI flows, onboarding, wizards,
  review/approval flows, navigation changes, or anything where the reviewer
  needs to operate the behavior. Keep the static wireframes in
  `content.canvas`, add the aligned functional prototype in
  `content.prototype`, and rely on the top visual tabs to switch between them.
- **Prototype-first** when the user explicitly asks for `/prototype-plan`, asks
  to operate the UI, or when interaction is the main question. Use
  `create-prototype-plan`, which still preserves static mocks where useful.

For mixed canvas + prototype plans, reuse the same real labels, app statuses,
and screen ids across both surfaces. The canvas is the inspectable static reference;
the prototype is the interactive version of that same flow, not a separate
design direction.

<!-- SHARED-CORE:wireframe-canvas START -->

## Wireframe & Canvas Core

This section is shared, word for word, by `/visual-plan` and `/ui-plan`. It is
the single source of truth for how wireframes and the canvas work. Do not
paraphrase it per command.

**A wireframe is an HTML mockup. The renderer owns the look; you write the
content.** Set `data.html` to a self-contained, semantic HTML fragment of the
screen and set `data.surface`. The renderer owns the surface footprint/aspect,
the dark/light theme, the hand-drawn font, and the rough.js sketch overlay — you
never write `<html>`/`<body>`/`<script>`/`<style>` tags, font-family, hex colors,
or any width/height/coordinates. You write real HTML layout and real product
content; the renderer styles and roughens it.

**A wireframe block's data is an HTML screen plus a surface:**

```json
{
  "surface": "browser",
  "html": "<div style=\"display:flex;flex-direction:column;gap:10px;padding:16px;height:100%\"><h1>Sign in</h1><p class=\"wf-muted\">Use your work email to continue.</p><div class=\"wf-card\" style=\"display:flex;flex-direction:column;gap:10px\"><label>Email<input value=\"jane@acme.co\" /></label><label>Password<input value=\"••••••••\" /></label><label style=\"display:flex;align-items:center;gap:8px\"><input type=\"checkbox\" checked /> Remember me</label><button class=\"primary\">Sign in</button></div><a href=\"#\">Forgot password?</a></div>"
}
```

**Write PLAIN semantic HTML and let the renderer style it.** Bare elements
(`h1`/`h2`/`h3`, `p`, `button`, `input`, `<input type="checkbox">`, `a`, `hr`)
are auto-themed — no classes needed. Helper classes carry the rest:

- `.wf-card` / `.wf-box` — a bordered, padded container (a panel, a list item).
- `.wf-pill` / `.wf-chip` — a rounded tag or filter; add `.accent`
  (`<span class="wf-pill accent">`) for the accent-filled variant.
- `.wf-muted` — secondary/muted text (or use `<small>`).
- `button.primary` or any element with `[data-primary]` — the accent-filled
  primary button.

**Use the `--wf-*` tokens for any custom color, never hex.** The renderer flips
these on light/dark, so reading them is what keeps a mockup correct in both
themes. For any inline border, background, or text color, reference a token:
`style="border:1.4px solid var(--wf-line)"`. The tokens are `--wf-ink` (text),
`--wf-muted` (secondary text), `--wf-line` (borders/dividers), `--wf-paper`
(page background), `--wf-card` (raised surface), `--wf-accent` /
`--wf-accent-fg` / `--wf-accent-soft` (brand action), `--wf-warn`, `--wf-ok`,
and `--wf-radius`. Never hard-code a hex color and never set `font-family` — the
renderer owns the sketch/clean font.

**Lay out with inline `style` flex/grid.** You write the real layout —
`display:flex; flex-direction:column; gap:10px; padding:16px` and so on — and the
renderer never repositions anything. Compose the actual product: reproduce the
current screen, then show the modification. Real labels, real counts, real dates,
real button text grounded in the screen you read; not lorem or gray bars.

**Surface presets — match the real footprint, never default to desktop+mobile.**
Pick the `surface` that matches what the user will actually see:

- `browser`: a web page that needs a browser chrome frame around it.
- `desktop`: a full desktop app page or app shell.
- `mobile`: a phone screen, only when the work is genuinely mobile.
- `popover`: a small floating menu, dropdown, or inline popover.
- `panel`: a side panel, inspector, or sidebar widget.

The surface locks the footprint and aspect; never set width/height/coordinates.
A sidebar popover renders as a small surface, not a desktop page and a phone
frame. Do not emit `desktop` + `mobile` variants unless responsive behavior
actually changes the layout. For a component or widget, show one broader
app-context frame only when placement affects understanding, then the focused
component states.

**Modify, don't redesign.** When the task changes an existing screen, reproduce
the current screen's real layout and footprint FIRST, then change only the delta
and call it out with a single annotation. Do not restack the page into a new
layout. For net-new surfaces, compose from the real app shell.

**Classify mockup scope before implementation.** Before turning a plan mockup
into source code, decide whether each artboard represents the whole page/app
shell, a route body inside an existing shell, or a component/sub-surface. If an
artboard includes navigation, sidebars, auth banners, or a signup/login form,
map those pieces to the real shared shell/auth components instead of nesting the
entire mockup inside the current page. When a mockup references the product's
standard signup/login page, find and reuse that existing implementation; do not
approximate it from the wireframe.

**Zoom in on sub-surfaces, don't redraw the page.** For a small sub-surface (a
popover, menu, dialog, toast), show the full screen once, then add a small
separate artboard whose `html` contains ONLY that sub-surface — do not re-draw
the whole page around it, and do not scale a duplicate up. Pick the matching
`surface` (e.g. `popover`) so the footprint is right; never widen a popover to
page width.

**Loading / skeleton states.** Set `data.skeleton: true` on the wireframe and
fill the `html` with neutral, textless placeholder geometry — boxes and bars
built as `<div>`s with `background:var(--wf-line)` and explicit heights/widths,
no labels or copy. The renderer drops borders, sketch, and color into the
skeleton register automatically. Never escape to a `custom-html` document block
to fake a loader, and never move a mockup out of the canvas — mockups always
live in canvas artboards.

**Editing an existing mockup.** To change one element, text, or color in an
existing html mockup, do NOT regenerate the frame — call `update-visual-plan`
with `contentPatches: [{ op: "patch-wireframe-html", blockId, edits: [{ find,
replace }] }]`. Each `find` is a unique snippet of the current html (read it
first with `get-visual-plan`); set `all: true` on an edit to replace every
occurrence. The result is re-sanitized.

**Canvas annotations are designer notes on the artboard.** When a top canvas is
present, sprinkle Figma-style notes near the frames they explain: a short
heading, supporting text, and bullets — plain text layers, never bordered or
shadowed cards, and never a box around a frame. The renderer spaces notes away
from frames, so place each note by the frame it describes. Use an arrow only to
point at one specific control or transition; for a broad frame-level note, write
text beside the frame with no connector. Connectors are for real sequences only —
never fake "Step 1 → Step 2" lines between independent states.

**Do not create overlapping annotations.** Anchor each note to the frame it
explains with `targetId` + `placement` (top/right/bottom/left). The renderer
parks notes in a gutter beside the frame and lays them out automatically — never
supply x/y or points for anchored notes; hand-placed coordinates fight the
auto-layout and cause the overlap you're trying to avoid. Reserve arrows for a
note that must point at a specific control inside a frame; a note that simply
sits beside its frame needs no arrow.

**Patching.** Edit one wireframe, canvas annotation, or block with targeted `contentPatches`
(for example `update-block`, `replace-blocks`, `update-canvas-annotation`) rather
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

**Fill the frame; keep labels short.** Each artboard is a fixed-size surface — compose enough realistic HTML to fill it top to bottom with even vertical rhythm; never leave a large empty band. On desktop/app-shell sidebars, let the nav stack flex to fill (`flex:1`) and add any persistent bottom action/status after it so the rail reads complete in taller frames. On mobile especially, flow real rows down the whole screen (status bar, header, then list/detail content) rather than a header floating above a gap. Keep every label short enough to sit on one line within its column — shorten the copy rather than relying on the frame to absorb it (long labels wrap or clip).

**Good example — a contacts list, surface `browser`.** A small, real screen
composed from the helper classes and tokens, layout in inline flex, no fonts or
hex colors:

```html
<div
  style="display:flex;flex-direction:column;gap:12px;padding:16px;height:100%"
>
  <div style="display:flex;align-items:center;justify-content:space-between">
    <h1>Contacts</h1>
    <button class="primary">New contact</button>
  </div>
  <div style="display:flex;gap:6px">
    <span class="wf-pill accent">All 128</span>
    <span class="wf-pill">Favorites</span>
    <span class="wf-pill">Archived</span>
  </div>
  <div
    class="wf-card"
    style="display:flex;flex-direction:column;gap:0;padding:0"
  >
    <div
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1.4px solid var(--wf-line)"
    >
      <div
        style="width:32px;height:32px;border-radius:999px;background:var(--wf-accent-soft)"
      ></div>
      <div style="flex:1">
        <strong>Jane Cooper</strong><br /><small>jane@acme.co</small>
      </div>
      <span class="wf-pill">Lead</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px">
      <div
        style="width:32px;height:32px;border-radius:999px;background:var(--wf-accent-soft)"
      ></div>
      <div style="flex:1">
        <strong>Marcus Lee</strong><br /><small>marcus@globex.io</small>
      </div>
      <span class="wf-pill">Customer</span>
    </div>
  </div>
</div>
```

**UI mockups belong in the top visual review area.** Static UI/product visuals
live on the canvas; multi-step UI flows get both canvas wireframes and a
prototype. When the user asks for a mockup, UI state, loading state, layout,
screen, or visual comparison, make the canvas the primary home for that static
visual. When the user asks for a prototype or the plan contains a sequence the
reviewer must feel, keep the canvas artboards and add `content.prototype` so the
top surface shows Wireframes / Prototype tabs. Architecture/code diagrams are
different: keep them inline in the document, close to the recommendation they
support, unless the user explicitly asks for a spatial board. Document blocks
can explain, compare, or map implementation, but they should not host the
primary UI mockup or prototype just because `custom-html`, screenshots, or prose
are easier to produce. If the canvas/prototype surface cannot represent the
requested UI fidelity, still keep the closest top-surface representation and
call out or extend the needed renderer capability.

**Legacy kit tree.** Older plans set a `screen` array of `{ el, ...props }` kit
nodes instead of `html`; the renderer still accepts and displays it, but new
plans emit `html`. Do not author fresh kit-tree screens — write the HTML mockup
instead. Likewise, old or imported plans may carry coordinate-based regions or
free-float x/y on notes or artboards; those are legacy escape hatches the
renderer still shows but you must never produce. The `surface` drives the aspect
and footprint, the canvas auto-places artboards, and the gutter parks notes by
`targetId` + `placement`; never supply width, height, or coordinates for a new
plan.

<!-- SHARED-CORE:wireframe-canvas END -->

<!-- SHARED-CORE:document-quality START -->

## Document Quality Core

This section is shared, word for word, by `/visual-plan` and `/ui-plan`. It is
the single source of truth for the document below the canvas. Do not paraphrase
it per command.

**The document is a serious technical plan, not marketing.** Write it the way a
strong Claude or Codex implementation plan reads: outcome-first, prose-first,
self-contained, and specific. State the objective and what "done" means, the
scope and non-goals, the proposed approach with the key decisions and their
rationale, ordered steps that name real files, symbols, actions, and data
shapes, the risks, and a closing verification step (tests, build, or a checkable
behavior). Replace vague prose with specifics; never ship a step like "make it
work." No hero art, gradients, logos, nav bars, slogans, value props, giant
landing-page headings, or marketing cards unless the user explicitly asks.

**When top visuals exist, they and the document never duplicate each other.**
For UI work, the UI story lives in the top visual surface: canvas artboards for
static inspection, plus prototype tabs when the flow should be functional. The
document carries the technical depth the visuals cannot show — concrete
file/symbol maps, API and data contracts, code snippets, migration or
implementation phases, risks, and validation. For architecture/code reviews,
invert that: the document is the visual surface, and each recommendation should
carry its own nearby inline `diagram` / `data-model` block plus file evidence
and terse Problem/Solution/Why text. For architecture/code diagrams, prefer
standard two-dimensional layouts: paired before/after panels, layered diagrams,
swimlanes, dependency maps, matrices, or grouped regions. Do not default to
left-to-right chains; use a line only when the relationship is truly a sequence.
Use native `diagram` blocks with `data.html` / `data.css` for these richer
layouts; the fragment may use semantic HTML and inline SVG, and the renderer
applies the viewer's sketch/clean style. Legacy `nodes` / `edges` are only for
tiny previews or genuinely linear step flows. Repeat a wireframe in the document
only for a genuinely new detail view or comparison. Skip the visual surface
entirely for non-visual work and write a clean rich document. For a simple
binary UI visual choice, show the two directions in the canvas only; do not
repeat the same options as body wireframes, a `decision` block, or prose. Put
the actual choice in the bottom "Open Questions" form.

**Use the right block, and make it carry substance.** For the authoritative,
machine-checked list of block types and their data schemas, call `get-plan-blocks`
— it returns the live registry vocabulary (type, MDX tag, placement, key fields)
so you never emit a block the editor cannot render or round-trip:

- `rich-text` for plan prose with real bold/italic/code/links and nested lists.
- `implementation-map` / `code-tabs` for the file map: file path, the
  symbols/components to touch, the reason, risk/coordination notes, and a
  concise syntax-highlighted snippet of the code shape in every file tab —
  never the whole file, never a prose-only file list. If the exact code is not
  known yet, include the smallest plausible planned shape or a short comment
  stub that names what needs to be filled in.
- `decision` for two or three option cards with consequences. These are static
  records; do not style them like clickable tabs or chips unless the renderer
  truly supports changing the selection.
- `diagram` for two-dimensional architecture, dependency, data-flow, or state
  relationships, only when it clarifies something real. For architecture/code
  diagrams, prefer `data.html` / `data.css` with semantic HTML and inline SVG so
  the diagram can use panels, layers, matrices, arrows, annotations, and
  responsive layout directly. Use legacy `nodes` / `edges` only for small
  previews or truly sequential flows. In architecture/code plans, prefer a
  repeated section rhythm: recommendation title, confidence and category badges,
  code-path evidence, a local before/after or current/target spatial diagram,
  then concise Problem/Solution/Why text. Labels must not overlap nodes,
  connectors, or each other.
- `tabs` for multiple states, directions, or comparisons. A tab that reveals
  only prose usually means the plan is under-specified — include a relevant
  visual unless the tab is intentionally document-only.
- `table`, `checklist`, `callout` for scannable structure.

**Open questions live at the bottom as a form when answers would change the
plan.** Surface answerable unresolved decisions in a final `question-form`
block titled "Open Questions" so the renderer presents it as a distinct section.
Use `single` or `multi` for clear choices, `freeform` for constraints,
`recommended: true` for the default you would pick, and option `wireframe` /
`diagram` previews only when the options are not already visible in the top
canvas. Keep non-answerable assumptions or risks as concise `callout` blocks in
the relevant section. Never bury a questions/decisions wall inside the plan
narrative, and never ask the same question in both a `decision` block and a
`question-form`.

**`custom-html` is a bounded escape hatch only** — a single complete fragment
inside a block, never `html`/`head`/`body`/`script` tags, never a generic
placeholder, density demo, or proof that custom HTML works. Prefer the native
blocks for normal plans. For architecture/code reviews, use `diagram`
`data.html` / `data.css` for rich local HTML/SVG diagrams instead of
`custom-html`. For UI/product work, `custom-html` is never the primary home for a
requested mockup, UI state, or visual comparison. If UI fidelity requires
HTML/CSS, image capture, or real React/CSS, the product fix is canvas support
for that artifact type, not moving the mockup into the document.

**Before handoff, open the plan and check it.** Fix overlap, excessive
whitespace, clipped fragments, misleading inactive controls, poor contrast, and
unreadable diagrams before asking for approval.

<!-- SHARED-CORE:document-quality END -->

<!-- SHARED-CORE:exemplar START -->

## Good vs. Bad Exemplar

**GOOD.** A `/ui-plan` for a todo app: a canvas with a `desktop` artboard whose
`data.html` is a real flex layout — a sidebar of links (`Inbox 12`, `Today 4`,
`Done`), a main column with an `<h1>Today</h1>`, accent `.wf-pill`s for the
filters, a muted section label `OVERDUE`, and `.wf-card` task rows carrying real
titles, due dates, and a primary `button.primary` — styled only through bare
elements, helper classes, and `--wf-*` tokens, so the renderer applies the
correct desktop footprint, theme, and one subtle whole-frame wobble. Plain-text
designer notes sit spaced off the frame, pointing only at the controls that need
explanation. Below it, a Claude/Codex-grade document: objective and
done-criteria, an `implementation-map` naming the real components and actions
with short highlighted snippets, a `decision` card weighing two real approaches,
and a validation step — none of it repeating the canvas. If the task also
changes a multi-step completion flow, the same top area includes a Prototype tab
whose screens use the same labels and states as the canvas artboards, with
`data-goto` controls for the sequence. This is the bar.

**GOOD.** A `/visual-plan` for a backend architecture review: no top canvas.
The document opens with context and a legend, then repeats recommendation cards:
title, confidence/category badges, a monospace grid of real file paths, one
inline two-dimensional before/after or layered architecture diagram, and terse
Problem/Solution/Why bullets using the codebase's vocabulary. The diagram uses
space to show boundaries, layers, and ownership; it is not a default
left-to-right chain. The plan ends with a top recommendation and a bottom
question-form only if the next architecture direction is genuinely open. This is
better than a top canvas because each diagram is local to the claim it supports.

**BAD.** A `data.html` with hard-coded hex colors, a `font-family`, or fixed
pixel width/height; gray placeholder bars "insinuating" text on a non-skeleton
frame; a forced desktop + mobile pair for a popover; floating bordered
annotation cards hugging the frames; a fresh hand-authored kit-tree `screen`
instead of `html`; a multi-step UI flow with only static frames and no prototype
tab; a mockup escaped into a document `custom-html` block; and a marketing-style
document with a hero heading and value props that just restates what the canvas
already shows. Also bad: an architecture-only plan forced into a top canvas of
labeled boxes with overlapping text, where the actual code evidence and
recommendations live elsewhere. Never produce this.

<!-- SHARED-CORE:exemplar END -->

## Tool Guidance

- `create-visual-plan`: start one structured visual plan per agent task/run, or
  import an existing text plan by passing `planText`; `content` may include no
  visual surface, canvas only, or canvas + prototype.
- `create-ui-plan`: start a UI-first plan when the work is primarily product UI.
- `create-prototype-plan`: start a prototype-first plan with a functional top
  review surface.
- `create-plan-design`: start a full-fidelity branded Design-tab plan with an
  optional matching Prototype tab.
- `convert-visual-plan-to-prototype`: convert an existing HTML wireframe canvas
  into a prototype plan.
- `create-visual-questions`: use only for the explicit `/visual-questions`
  command, not as `/visual-plan` preflight.
- `update-visual-plan`: revise content, status, or comments; prefer
  `contentPatches` over regenerating the whole plan.
- `read-visual-plan-source`: read the normalized plan as `plan.mdx`,
  optional `canvas.mdx`, optional `.plan-state.json`, and JSON.
- `patch-visual-plan-source`: apply granular MDX AST patches by stable block,
  artboard, annotation, component, or wireframe-node id.
- `import-visual-plan-source`: create or replace a plan from an MDX folder.
- `get-visual-plan`: read the current structured plan, exported HTML, and
  annotations; it also returns the MDX folder for source workflows.
- `get-plan-feedback`: read unconsumed human feedback. Use it frequently; it
  returns grouped threads, exact anchor details, expected resolver, and recent
  review-event payloads so agents can act only on the comments meant for them.
- `export-visual-plan`: export HTML, Markdown fallback, structured JSON, and MDX
  files for repo check-in.

When the user critiques a plan's look or structure, fix the renderer or this
skill — never hand-edit one stored plan. Turn feedback into better guidance.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and
authenticates it in the same step (a one-time browser sign-in at setup — this is
intended), so the first tool call does not hit an OAuth wall:

```bash
agent-native skills add visual-plan
```

After that, `/visual-plan` (and `/ui-plan`, `/prototype-plan`, `/plan-design`,
`/visual-questions`) generate a plan and open the editor. Pass `--no-connect` to
register the connector without authenticating, then run
`agent-native connect https://plan.agent-native.com` whenever you are ready.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns `needs auth`, `Unauthorized`, or `Session terminated`,
do not keep retrying the tool. Authenticate the connector with
`agent-native connect https://plan.agent-native.com` (OAuth-capable hosts can
instead re-run /mcp and choose Authenticate), then continue once the connector
is available.

Hosted default: connect `https://plan.agent-native.com/_agent-native/mcp`. Do
not put shared secrets in skill files.
