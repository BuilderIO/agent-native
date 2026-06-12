# Plan document quality — single source of truth

This file is the canonical quality bar for the plan document below the canvas:
how it reads, which blocks to use, how open questions are surfaced, and the
pre-handoff check. Read it in full before authoring the plan document; it is the
quality bar. Do not write the document from memory or paraphrase these rules per
mode.

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

**Every published plan must stand alone.** Even when the agent is revising an
existing plan, the output is a plan to do the work, not a changelog of the
conversation. Do not write phrases like "preserve the previous plan", "do not
drop the old idea", "as discussed above", "this revision", "unlike the prior
version", or "correction from the earlier plan". Fold the right decisions into
the plan as normal objective, architecture, scope, and roadmap prose. A reviewer
who opens the plan from a link with no chat history should understand it.

**When top visuals exist, they and the document never duplicate each other.**
For UI work, the UI story lives in the top visual surface: canvas artboards for
static inspection, plus prototype tabs when the flow should be functional. The
document carries the technical depth the visuals cannot show — concrete
file/symbol maps, API and data contracts, code snippets, migration or
implementation phases, risks, and validation. For architecture/code reviews,
invert that: the document is the visual surface, and each recommendation
carries its own nearby inline `diagram` / `data-model` block plus file
evidence (the `diagram` bullet below owns how to author those diagrams).
Repeat a wireframe in the document only for a genuinely new detail view or
comparison. Skip the visual surface entirely for non-visual work and write a
clean rich document. For a simple binary UI visual choice, show the two
directions in the canvas only; do not repeat the same options as body
wireframes or prose. Put the actual choice in the bottom "Open Questions" form.

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
  relationships, only when it clarifies something real. Prefer standard
  two-dimensional layouts — paired before/after panels, layered diagrams,
  swimlanes, dependency maps, matrices, or grouped regions; do not default to
  left-to-right chains, and use a line only when the relationship is truly a
  sequence. For architecture/code
  diagrams, prefer `data.html` / `data.css` with semantic HTML and inline SVG so
  the diagram can use panels, layers, matrices, arrows, annotations, and
  responsive layout directly. Author diagram HTML with renderer-owned primitives
  like `.diagram-panel`, `.diagram-card`, `.diagram-node`, `.diagram-box`,
  `.diagram-pill`, `.diagram-muted`, and `[data-rough]`; they map to the plan's
  Tailwind theme variables through `--wf-ink`, `--wf-muted`, `--wf-line`,
  `--wf-paper`, `--wf-card`, `--wf-accent`, `--wf-accent-soft`, `--wf-warn`, and
  `--wf-ok`, and switch to Excalifont plus rough.js outlines in sketchy mode. Do not
  set `font-family` and do not hard-code hex, rgb, or hsl colors in diagram HTML
  or CSS. Leave room for the sketch font: keep labels short, give nodes generous
  width, and place boundary/annotation labels in unused space instead of over
  nodes; labels must not overlap nodes, connectors, or each other. For small
  text/SVG changes to an existing HTML diagram, use `patch-diagram-html` with a
  unique `find`/`replace` snippet instead of resending the whole `data.html`
  string. Use legacy `nodes` / `edges` only for small previews or truly
  sequential flows. In architecture/code plans, prefer a repeated section rhythm:
  recommendation title, confidence and category badges, code-path evidence, a
  local before/after or current/target spatial diagram, then concise
  Problem/Solution/Why text.
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
