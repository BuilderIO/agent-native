---
name: visual-recap
description: >-
  Use Agent-Native Plans to turn a code change, PR diff, or git diff into a
  visual recap plan for high-altitude review — schema, API, file, and
  before/after changes as grounded structured blocks instead of a wall of diff.
metadata:
  visibility: exported
---

# Visual Recap

`/visual-recap` creates a visual plan built **from** a diff, not toward one. It
is the reverse of forward planning: instead of describing the change you are
about to make, you describe the change that was just made, at a higher altitude
than line-by-line review. The same plan data model serves both directions —
schema, API, file, and architecture changes become the same `data-model`,
`api-endpoint`, `file-tree`, and `diagram` blocks a forward plan would use, only
now they summarize work that exists. A reviewer scans the shape of the change
before spending attention on the literal lines.

## When To Use

Build a recap when a PR or commit is large, multi-file, or touches schema, API
contracts, or architecture, and a reviewer would benefit from seeing the change
mapped to structured blocks before reading the raw diff. A GitHub Action can
generate one automatically from a PR diff; an agent can generate one on request
("recap this PR", "show me what this branch changed"). Skip it for small,
single-file, or obvious diffs — a recap is review overhead, and a tiny change
reviews faster as plain diff.

## Recap The Whole Work Unit

When `/visual-recap` is invoked in a chat thread after work has already happened,
the default scope is the whole current work unit/thread, not only the most recent
user message, tool action, or follow-up fix. Gather the thread-owned changes
across the conversation: original implementation work, later bug fixes, UI
follow-ups, tests, changesets, skill/instruction updates, generated plan/source
artifacts, and any local import/linking fixes needed to make the recap open.

Use the current diff plus conversation context to separate thread-owned changes
from unrelated dirty work that existed before the thread. Exclude unrelated
pre-existing edits. If the scope is genuinely ambiguous and cannot be inferred,
state the assumption or ask a concise question before publishing.

When updating an existing recap after feedback, revise the recap so it still
covers the whole thread/work unit plus the new correction. Do not replace a broad
recap with a narrow recap of only the latest feedback unless the user explicitly
asks for that narrower scope.

## Keep The Recap Body Lean

Do not add boilerplate intro, disclaimer, provenance, or summary prose blocks to
the generated plan body. In particular, do not create a `rich-text` block just to
say the recap is an aid, that the reviewer should still review the diff, how many
files changed, or which ref/working tree generated the recap. The plan title,
brief, `file-tree`, and optional `diffstat` already carry that context.

Only add prose blocks when they tell the reviewer something specific about the
change that the structured blocks do not: the objective, a real compatibility
risk, an important decision visible in the diff, or a grounded review note.

## UI Impact Needs Wireframes

When the diff changes rendered UI, layout, density, visual state, interaction
affordances, navigation, controls, menus, dialogs, or design tokens, the recap
MUST include one or more wireframes. Prose and file diffs are not a substitute
for showing what changed visually.

Choose the smallest visual surface that makes the review clear:

- Use a `Before` / `After` wireframe pair when the reviewer benefits from direct
  comparison, such as a removed or added control, a changed state, layout
  density, ordering, navigation, or a visible component replacement. Choose the
  comparison layout by geometry: use a `columns` block labeled `Before` and
  `After` when each state remains legible side by side; stack `Before` then
  `After` vertically in normal document flow when the surfaces are very wide,
  when full-width scanning matters, or when columns would shrink or crop the
  important detail.
- Use an after-only wireframe when the change is purely additive or the "before"
  state would only show absence without adding review value.
- Use more than two wireframes when the UI change is flow-dependent, responsive,
  or stateful; show the meaningful states in order instead of forcing a single
  before/after pair.
- For tiny surfaces like menus, popovers, dialogs, toasts, or panels, use the
  matching `surface` (`popover`, `panel`, etc.) and show the focused sub-surface.
  Do not redraw a full page unless placement in the page is itself part of the
  change.

Ground each wireframe in the changed UI behavior, component names, file paths,
and diff-visible labels/states. If exact pixels are inferred rather than
captured, say so in the wireframe caption or a concise annotation. For
local/manual recaps, import or update the plan source that holds the wireframes
so the rendered recap opens with the UI visual available.

## UI Wireframe Quality Bar

UI recap wireframes must look like the UI surface that changed, not like generic
architecture boxes. A rendered UI change belongs in `wireframe` /
`WireframeBlock`; reserve `diagram` for architecture, dependency, state, or
data-flow relationships.

For small component surfaces, model the actual component shell:

- Popovers, dropdown menus, command palettes, and context menus use
  `surface: "popover"` unless the surrounding page placement is the point of the
  change.
- Dialogs, sheets, inspectors, sidebars, and long property panels use the
  matching `panel` / `desktop` surface as appropriate.
- Show the real chrome: trigger or anchor when it matters, title/header row,
  top-right actions, separators, fields, options, selected states, body content,
  and footer actions that are visible in the changed workflow.

Before/after wireframes must be comparable:

- Choose the comparison layout deliberately. Side-by-side `columns` are best for
  compact states where placement and density can be compared without shrinking
  the frames. Very wide surfaces such as full browser rows, tables, diagrams,
  code/API examples, or dense dashboards should stack vertically (`Before` first,
  then `After`) so each wireframe can use the full document width.
- Label each state visibly as `Before` and `After` inside the wireframe itself
  (for example, a header pill), in addition to any column title or caption, so
  screenshots and cropped embeds stay unambiguous. When states are stacked,
  repeat the state in the block title or a label immediately above the frame.
- Treat canvas artboard placement separately from flex layout inside the
  wireframe. The renderer locks each artboard to its `surface` preset
  (`desktop`, `browser`, `popover`, `panel`, etc.) and ignores model-supplied
  `width` / `height` when drawing the frame. Prefer omitting `x`, `y`, `width`,
  and `height` so the canvas auto-layout spaces frames correctly. If manual
  positions are necessary, calculate them from the real surface preset plus a
  generous gap; never try to "fix" overlap by shrinking `width` / `height` in
  MDX.
- Use the same frame size, scale, outer padding, border radius, and visual
  density on both sides unless the diff itself changes those properties.
- Let the frame height fit the useful content when viewport height is not the
  point. For focused component recaps, prefer `popover`, `panel`, or an HTML
  wireframe with content-fit/min-height styling over a tall `browser` /
  `desktop` frame that leaves a large empty lower half. Keep a fixed aspect
  ratio only when the diff changes viewport-scale layout, scrolling, or
  below-the-fold placement.
- Give the wireframe composition its own padding inside the rendered
  `WireframeBlock` surface so mockup cards, state labels, and captions do not
  press against the block edge.
- Inside a wireframe, use the kit's flex primitives (`Row`, `Col`, `Main`,
  `Box`) or HTML flex/grid with `gap`, `min-width: 0`, and sensible overflow.
  Avoid negative margins, absolute positioning, or fixed child widths that can
  collide when the Plan renderer switches between light/dark, sketch/clean, or
  different zoom levels.
- Keep text away from borders. Every container, field, button, menu item, and
  annotation needs enough padding and line-height to read cleanly in the rendered
  Plan view.
- For tab rails, breadcrumbs, file chips, code filenames, and other intentionally
  single-line labels, do not let long text wrap. It is acceptable and usually
  preferable for recap wireframes to use `white-space: nowrap`,
  `overflow: hidden`, and `text-overflow: ellipsis` (or abstract bars) so the
  wireframe demonstrates the actual layout behavior instead of producing ugly
  vertical text. Use horizontally scrollable or clipped rails for overflow.
- Preserve unchanged controls in both states so the reviewer can see exactly
  what moved or appeared. Do not show an added control as a generic box floating
  elsewhere in the surface.
- Highlight or label the new/changed affordance only after it is placed where
  the implementation puts it. For example, a new `Edit with AI` action in a
  popover header must appear in the top-right header slot, aligned with the
  title, not in the body or footer.
- If the new action opens another popover, menu, or composer, include the opened
  state only when it clarifies the flow, and anchor it to the actual trigger.

Use the standard `WireframeBlock` / `<Screen>` format so the Plan viewer owns the
surface frame, theme, and sketchy/clean toggle. HTML wireframes are appropriate
when placement precision matters, especially popovers, menus, dialogs, and dense
forms; kit-tree wireframes are appropriate for simpler layouts. For HTML
wireframes, keep `renderMode` unset or `wireframe` unless a design-only editable
mockup is explicitly required, because `renderMode="design"` disables the
sketchy rough overlay. Use renderer-owned `--wf-*` tokens, semantic controls, and
rough targets such as `[data-rough]`, `.wf-card`, `.wf-box`, buttons, inputs, and
textareas; avoid hard-coded colors, text-only boxes, cramped labels, raw
coordinate diagrams, and abstract before/after cards that do not resemble the
product surface.

Before sharing a UI-impact recap, render it in the Plan viewer and inspect the
top canvas at the current theme. If any artboard, label, annotation, toolbar, or
wireframe content overlaps another element, fix the MDX and re-import before
reporting the link. A text-match screenshot is not enough; visually inspect the
captured image.

## Open And Report The Recap

After creating the recap, link the reviewer to the rendered plan with an
**absolute URL**. Never make the primary link a local `plan.mdx` file, a local
mirror folder, or a relative path such as `/plans/<id>`.

Resolve the URL in this order:

1. When creating a recap for local edits and a running local/dev Plan app origin
   is known, prefer that local origin even if `plan.mdx` includes a hosted
   `visualUrl`, e.g. `http://localhost:8081/plans/<id>`.
2. Use the absolute `visualUrl` exported in `plan.mdx` frontmatter when present,
   e.g. `https://plan.agent-native.com/plans/<id>`.
3. If the action returns only a relative `url`/`path` and the running app origin
   is known, construct an absolute URL from that origin, e.g.
   `http://localhost:5173/plans/<id>`.
4. If only the plan id is available, build the hosted absolute URL
   `https://plan.agent-native.com/plans/<id>` and say if that URL was inferred.

When running in Codex and the Browser/in-app side browser tools are available,
open the absolute recap URL there automatically after creation. Still include the
same absolute URL in the final response. Local mirror files like
`plans/<slug>/plan.mdx` may be mentioned only as secondary source-control
artifacts, not as the main way to open the recap.

## Diff → Block Mapping

Map each kind of change to the block that carries it, derived mechanically from
the actual diff:

- **Schema / migration change** → `data-model` for the resulting entities,
  fields, and relations, plus a `diff` with `mode: "split"` for the literal SQL
  or schema text that changed. The `data-model` shows the new shape; the split
  `diff` shows exactly what moved.
- **API / action / route change** → `api-endpoint` with the method, path,
  params, request, and responses as they are after the change. Mark removed
  endpoints with `deprecated: true` and explain in prose.
  Keep multiple API endpoints in the normal single-column document flow unless
  they are an explicit before/after contract comparison.
- **Compatibility-sensitive change** → short `rich-text` notes beside the
  relevant `data-model` / `api-endpoint` block. Name the changed field,
  endpoint, or behavior and mark whether it is breaking, risky, or non-breaking;
  pair that note with a split `diff` for the literal lines.
- **Any meaningful code hunk** → `diff` with `mode: "split"`, carrying the real
  `before` / `after` text and the `filename` / `language`. Split mode is the
  default for a recap because before/after legibility is the whole point.
  When several key files each need a substantial diff, group those `diff` blocks
  in a reusable `tabs` block with `orientation: "vertical"` so file labels form a
  left rail and the selected file's split diff renders on the right. Keep each
  tab label to the file path or a short basename plus directory hint.
  If the recap ends with more than one supporting diff, that trailing diff
  appendix should be one vertical `tabs` block, not a stack of separate `diff`
  blocks.
- **Files added / removed / renamed** → `file-tree` with each entry's `change`
  flag (`added`, `removed`, `modified`, `renamed`) and a short `note`; attach a
  `snippet` only when one tells the reviewer something the path does not.
- **Rendered UI / interaction change** → one or more wireframes showing the
  visible UI delta before the reviewer reads code. Use `Before` / `After`
  wireframes when the comparison clarifies the change; otherwise use after-only
  or a short state/flow sequence. Use realistic UI surfaces: for a popover
  change, show a popover with its title row, top-right actions, options/fields,
  and any opened prompt/menu anchored to the correct trigger. Keep the body lean:
  the wireframe carries the UI story, while the file tree and split `diff`
  blocks carry implementation evidence.
- **Architecture or data-flow shift** → `diagram` with `data.html` / `data.css`
  as a two-panel before/after, layered, or swimlane layout, or `mermaid` for a
  quick graph. Use the two-dimensional layouts the Document Quality core
  prescribes; do not reduce a structural change to a left-to-right chain.
  Do not use `diagram` as a stand-in for rendered UI controls; UI changes need
  `wireframe` blocks.
  Diagram HTML/CSS should use renderer-owned primitives such as
  `.diagram-panel`, `.diagram-card`, `.diagram-node`, `.diagram-box`,
  `.diagram-pill`, `.diagram-muted`, and `[data-rough]`; these map to the plan's
  Tailwind theme variables through `--wf-ink`, `--wf-muted`, `--wf-line`,
  `--wf-paper`, `--wf-card`, `--wf-accent`, `--wf-accent-soft`, `--wf-warn`, and
  `--wf-ok`, and switch to Virgil plus rough.js outlines in sketchy mode. Do not
  set `font-family` and do not emit hex, rgb/hsl literals, or one-off dark/light
  palettes in diagram CSS.
- **Outcome-first narrative** → `rich-text` for the "what changed and why" prose:
  the objective the diff served, the key decisions visible in it, and the risks a
  reviewer should weigh. This is the only place the model writes freely.

## Before / After Is The Headline

The recap's center of gravity is the before/after comparison. For document-body
comparisons there are two primitives, and they cover the whole need together:

- **`columns`** — the side-by-side container, for **structured** comparisons.
  Use two columns labeled `Before` and `After`, each holding a block (commonly a
  `data-model`, `api-endpoint`, or `rich-text`), so the reviewer reads the old
  shape against the new shape in one glance. This is the right primitive for
  "the schema went from X to Y" or "the endpoint contract changed like this."
  Do not use `columns` simply to compact or group a list of API endpoints.
- **`diff` with `mode: "split"`** — for **code**. The split renders the literal
  removed and added lines side by side. Use it for the actual hunks.

For UI diffs, wireframes are the visual comparison primitive. Use before/after
wireframes when side-by-side review helps; use after-only or a state sequence
when that better matches the change. The visual headline must show exact
placement, realistic chrome, and adequate padding before any abstract
explanation. Put paired UI wireframes inside `columns` labeled `Before` and
`After`; do not hand-build a side-by-side layout in `custom-html` or stack two
wireframes vertically when columns would make the comparison clearer. For
document-body comparisons, there is no other multi-column primitive — `columns`
plus split `diff` are the whole comparison vocabulary. Do not hand-build
side-by-side layouts in `custom-html`, and do not stack two `data-model` blocks
vertically and call it a comparison when `columns` exists to put them side by
side.

## Grounding Rule

Structured blocks are **true by construction** only if they are derived from the
actual changed lines. The `diff`, `data-model`, `api-endpoint`, and `file-tree`
blocks MUST be built mechanically from the real diff — real paths, real fields,
real method/path, real before/after text — never inferred, rounded, or invented.
The model writes only the prose: the "why", the narrative, the risk read. A
confidently wrong recap is dangerous in a review context, because a reviewer who
trusts the summary may skip the very line the summary got wrong. When the diff
does not contain a fact, leave it out rather than guess; mark anything the model
inferred (not extracted) as inferred in prose.

## Security

- **Gate visibility.** Recaps of a private repo are org/login-gated — set the
  plan's visibility to the owning org or login, never auto-public. A recap can
  expose unreleased schema, internal endpoints, and architecture; treat it like
  the source it summarizes.
- **Never transcribe secrets.** A diff can contain API keys, tokens, webhook
  URLs, signing secrets, `.env` values, or credential-looking literals. Do not
  copy any of these into a `diff`, `file-tree` snippet, `api-endpoint`, or prose
  block — redact them (`sk-•••`, `<redacted>`). This mirrors the repo's
  hardcoded-secret rule: obviously fake placeholders only, never the real value,
  in any block, caption, or note.

## Bidirectional Loop (Fast-Follow)

Because a recap is a real, editable plan, the same review loop as forward plans
applies: a reviewer can annotate any block, and the coding agent reads
`get-plan-feedback` to drive fixes back into the code — annotation → agent →
diff, the same close-the-loop flow forward plans use. In v1, recaps are
**read-only**: they summarize a merged or proposed change for review, and the
annotate-to-fix loop is a fast-follow, not yet wired. Build the recap so the
blocks are anchorable and the loop drops in later without restructuring.

## Related Skills

- **visual-plan** — the canonical command and the source of the shared Wireframe
  & Canvas and Document Quality cores; a recap follows the same block discipline
  in reverse.
- **security** — data scoping, secret handling, and the hardcoded-secret rule the
  recap's redaction and visibility gating mirror.
- **sharing** — org/login-gated visibility for the plan that holds the recap.
