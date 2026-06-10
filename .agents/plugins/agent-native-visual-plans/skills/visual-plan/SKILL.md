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
editable blocks mixed in: inline diagrams, code snippets,
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
  Lead with reuse: for each step, name what it reuses — existing actions, schema,
  components, helpers — before what it adds, so the plan explains the genuinely new
  delta instead of redescribing what already exists.
- **Decide the hard-to-reverse bets first.** For non-trivial backend, data, or API
  work, sketch where the feature is headed, then call out the decisions that are
  expensive to undo once data or callers depend on them — wire format, public ids,
  data-model shape, auth and ownership boundaries — and get those right in the plan
  even if most of the feature ships later. Then scope to the smallest first cut that
  proves the approach without foreclosing it, stating both what is in and what is
  explicitly deferred.
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

## Local-Files Privacy Mode

Use local-files privacy mode when the user explicitly asks for no DB writes,
no hosted Plan app, no Plan MCP publish, fully local files, offline/private
planning, or when `AGENT_NATIVE_PLANS_MODE=local-files` is set. In this mode the
plan data must never be sent to the Plan MCP server or Plan app action surface.

The local-files contract is:

- Read source context from local files and shell commands only.
- Write the plan as a local MDX folder under `plans/<slug>/`: `plan.mdx`,
  optional `canvas.mdx`, optional `prototype.mdx`, and optional
  `.plan-state.json`.
- Run `agent-native plan local preview --dir plans/<slug> --kind plan` after
  writing or updating the folder. Report the returned local URL or the
  `/local-plans/<slug>` route if the local Plan app is running with the same
  `PLAN_LOCAL_DIR`.
- Do **not** call `create-visual-plan`, `create-ui-plan`,
  `create-prototype-plan`, `create-plan-design`, `import-visual-plan-source`,
  `update-visual-plan`, `patch-visual-plan-source`, `get-plan-feedback`,
  `export-visual-plan`, or any hosted Plan tool for that plan.
- Treat feedback as file or chat feedback: update the MDX files directly, rerun
  the local preview command, and summarize the new local URL/path. Hosted
  comments, sharing, history, and publish/export receipts are unavailable until
  the user explicitly opts into publishing.

Local-files mode prevents plan content from going to the Agent-Native Plan
database. It does not by itself make the coding agent's language model local;
for that stronger privacy boundary, the host agent/model must also be local or
otherwise approved by the user.

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
   `content.prototype`; put `diagram`, `mermaid`, `api-endpoint`,
   `openapi-spec`, `data-model`, `diff`, `file-tree`, `json-explorer`,
   `code` and `annotated-code` blocks directly next
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
   rather than patching one plan by hand. For high-stakes plans (architecture,
   backend, data, multi-file, or risky), also kick off the self-review pass in
   **Self-Review Before Handoff** while the user reads, instead of blocking the
   handoff on it.
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

## Self-Review Before Handoff

For high-stakes plans — architecture, backend, data-model, migration, multi-file,
or otherwise risky work — run one adversarial self-review pass before treating the
plan as final. Skip it for small, UI-only, or single-decision plans where the cost
outweighs the value. Keep the pass cheap and non-blocking:

- **Surface the plan first, review concurrently.** Post the link and let the user
  start reading, then run the review in parallel — never make the user wait on it.
- **Review the written plan; do not re-research.** Critique the plan text and its
  own blocks. The grounding was already done while drafting, so the review checks
  the output instead of re-exploring the repo.
- **Spawn one skeptical reviewer** whose only job is to find what is weak, missing,
  or wrong — not to praise. Point it at: hard-to-reverse decisions made implicitly
  or not at all (wire format, public ids, data-model shape, auth, ownership); steps
  not anchored in real files or symbols; a menu of options where the plan should
  commit to one; obvious missing decisions ("what happens when X?", "why not Y?");
  and padding or single-step filler.
- **Fix vs. ask.** Apply clear-cut fixes yourself with `update-visual-plan`
  `contentPatches` — vague non-goals, unanchored claims, an obvious missing
  decision. Route genuine judgment calls back to the user instead: add them to the
  bottom `question-form` Open Questions block or batch them into the normal
  ask-user-question flow. Do not silently decide them.
- **Do not surprise the user mid-read.** On a large plan, apply the patches before
  the editor loads; otherwise note briefly that a self-review is running so the
  plan changing under them is expected. When you next respond, summarize what the
  review changed and what it surfaced for the user to decide.

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

## Wireframe quality — read `references/wireframe.md`

UI recap/plan wireframes must meet a strict quality bar — full-width chrome,
pinned bottom bars, real product content, before/after comparability, the right
`surface` preset, `--wf-*` tokens instead of hex, and no `<html>`/`<style>`/font
tags. Before authoring ANY wireframe / `<Screen>` / `WireframeBlock`, READ
`references/wireframe.md` in this skill directory — it is the single source of
truth for HTML wireframe quality, shared word for word with `/visual-plan`,
`/ui-plan`, and `/visual-recap`. Do not author wireframes from memory.

## Canvas Core

This section is shared by `/visual-plan` and `/ui-plan`, and is the single
source of truth for how the canvas works. The canvas/artboard mechanics apply
only to `/visual-plan` and `/ui-plan`. Do not paraphrase it per command.

<!-- SHARED-CORE:canvas-surface START -->

**Artboard placement is locked by the `surface`, not by coordinates.** The
surface locks the footprint and aspect; never set artboard width/height and
never use coordinates inside the wireframe HTML. Let canvas auto-placement
handle simple one-row boards. For mixed-footprint canvases, board-level artboard
`x`/`y` is allowed and expected when it creates clear lanes.

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
top surface shows Wireframes / Prototype tabs. Architecture/code diagrams are
different: keep them inline in the document, close to the recommendation they
support, unless the user explicitly asks for a spatial board. Document blocks
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
shows but you must never produce. The `surface` drives each artboard's aspect
and footprint, and the gutter parks notes by `targetId` + `placement`. The only
new-plan coordinate exception is deliberate board-level artboard `x`/`y` for
multi-lane mixed-surface canvases; never supply artboard width/height, note
coordinates, or wireframe-internal coordinates.

<!-- SHARED-CORE:canvas-surface END -->

## Document Quality Core

This section is shared, word for word, by `/visual-plan` and `/ui-plan`. It is
the single source of truth for the document below the canvas. Do not paraphrase
it per command.

<!-- SHARED-CORE:document-quality START -->

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
applies the viewer's sketch/clean style. Leave room for the sketch font: keep
labels short, give nodes generous width, and place boundary/annotation labels in
unused space instead of over nodes. For small text/SVG changes to an existing
HTML diagram, use `patch-diagram-html` with a unique `find`/`replace` snippet
instead of resending the whole `data.html` string. Legacy `nodes` / `edges` are
only for tiny previews or genuinely linear step flows. Repeat a wireframe in the document only
for a genuinely new detail view or comparison. Skip the visual surface entirely
for non-visual work and write a clean rich document. For a simple binary UI
visual choice, show the two directions in the canvas only; do not repeat the
same options as body wireframes or prose. Put the actual
choice in the bottom "Open Questions" form.

**Use the right block, and make it carry substance.** For the authoritative,
machine-checked list of block types and their data schemas, call `get-plan-blocks`
— it returns the live registry vocabulary (type, MDX tag, placement, key fields)
so you never emit a block the editor cannot render or round-trip:

- `rich-text` for plan prose with real bold/italic/code/links and nested lists.
- `annotated-code` for the file map: when a load-bearing file is worth
  highlighting, prefer the annotated walkthrough over a bare `code` block — carry
  the real, syntax-highlighted code AND anchor short margin notes to the lines
  that actually change (the new action, the changed schema, the wiring point), so
  the reader sees what matters and why instead of code for code's sake. Each
  annotation is `{ lines: "12" | "12-18"; label?; note }`; keep a few high-signal
  notes per file, not one per line. Highlight only the files worth reading; never
  an exhaustive list of every touched file, and never a prose-only description of
  a file. Drop to a plain `code` block only for a throwaway snippet with nothing
  to call out. When more than one file matters, group the blocks in a vertical
  `tabs` block (the standard tab primitive) rather than a bespoke container. If
  the exact code is unknown, show the smallest plausible planned shape or a
  commented stub naming what to fill in. (`code-tabs` and `implementation-map`
  are legacy: their renderers stay for old plans, but do not author new ones.)
- For a decision: if the reviewer must still pick between a genuinely-open
  either/or, put it in the bottom Open Questions `question-form` as a `single`
  question — one option per real alternative, each with a short detail and
  `recommended: true` on the one you would choose; do not also restate the same
  choice elsewhere. If you have already committed to an approach, state it as
  settled prose or a `callout` with `tone="decision"`, optionally with a
  `columns` block for a side-by-side comparison of the options you weighed — not
  as a confusing mid-document form for a question you have already answered.
- `columns` for side-by-side before/after or current/target comparisons where
  each side needs real nested blocks; label the columns clearly and avoid
  stacking comparison blocks vertically when parallel reading is the point.
- `diagram` for two-dimensional architecture, dependency, data-flow, or state
  relationships, only when it clarifies something real. For architecture/code
  diagrams, prefer `data.html` / `data.css` with semantic HTML and inline SVG so
  the diagram can use panels, layers, matrices, arrows, annotations, and
  responsive layout directly. Author diagram HTML with renderer-owned primitives
  like `.diagram-panel`, `.diagram-card`, `.diagram-node`, `.diagram-box`,
  `.diagram-pill`, `.diagram-muted`, and `[data-rough]`; they map to the plan's
  Tailwind theme variables through `--wf-ink`, `--wf-muted`, `--wf-line`,
  `--wf-paper`, `--wf-card`, `--wf-accent`, `--wf-accent-soft`, `--wf-warn`, and
  `--wf-ok`, and switch to Excalifont plus rough.js outlines in sketchy mode. Do not
  set `font-family` and do not hard-code hex, rgb, or hsl colors in diagram HTML
  or CSS. Use legacy `nodes` / `edges` only for small previews or truly
  sequential flows. In architecture/code plans, prefer a repeated section rhythm:
  recommendation title, confidence and category badges, code-path evidence, a
  local before/after or current/target spatial diagram, then concise
  Problem/Solution/Why text. Labels must not overlap nodes, connectors, or each
  other.
- `tabs` for multiple states, directions, or comparisons. A tab that reveals
  only prose usually means the plan is under-specified — include a relevant
  visual unless the tab is intentionally document-only.
- `table`, `checklist`, `callout` for scannable structure.

**Open questions live at the bottom as a form when answers would change the
plan.** Surface answerable unresolved decisions in a final `question-form`
block titled "Open Questions" so the renderer presents it as a distinct section.
That bottom form is the ONLY place that enumerates the open questions: never add
a second "Open Questions" heading, list, or recap of the same questions earlier
in the document. A one-line pointer in the overview prose ("a few decisions are
still open — see Open Questions below") is fine, but do not reproduce the
question list or a parallel questions/decisions section above it.
Use `single` or `multi` for clear choices, `freeform` for constraints,
`recommended: true` for the default you would pick, and option `wireframe` /
`diagram` previews only when the options are not already visible in the top
canvas. `single` and `multi` questions always render a write-in field so a
reviewer can answer with a custom option — never add an explicit "Other" option
yourself; set `allowOther: false` only when a free-text answer makes no sense.
Keep non-answerable assumptions or risks as concise `callout` blocks in
the relevant section. Never bury a questions/decisions wall inside the plan
narrative, and never ask the same question twice.

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

## Good vs. Bad Exemplar

<!-- SHARED-CORE:exemplar START -->

**GOOD.** A `/ui-plan` for a todo app: a canvas with a `desktop` artboard whose
`data.html` is a real flex layout — a sidebar of links (`Inbox 12`, `Today 4`,
`Done`), a main column with an `<h1>Today</h1>`, accent `.wf-pill`s for the
filters, a muted section label `OVERDUE`, and `.wf-card` task rows carrying real
titles, due dates, and a primary `button.primary` — styled only through bare
elements, helper classes, and `--wf-*` tokens, so the renderer applies the
correct desktop footprint, theme, and one subtle whole-frame wobble. Plain-text
designer notes sit spaced off the frame, pointing only at the controls that need
explanation. Below it, a Claude/Codex-grade document: objective and
done-criteria, a few `code` blocks (grouped in a vertical `tabs` block when
more than one) showing the real shape of the load-bearing files, a `callout`
with `tone="decision"` stating the chosen approach with a `columns` block
weighing the two real options behind it,
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

After that, `/visual-plan` (and `/visual-recap`, `/ui-plan`,
`/prototype-plan`, `/plan-design`, `/visual-questions`) generate a plan and open
the editor. Pass `--no-connect` to
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
