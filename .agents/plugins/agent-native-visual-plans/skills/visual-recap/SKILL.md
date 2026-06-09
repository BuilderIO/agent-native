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

## Always Publish As An Agent-Native Plan — Never Inline

The deliverable is ALWAYS a published Agent-Native Plan, created with the
`create-visual-recap` tool on the `plan` MCP server. NEVER hand the recap to the
user as inline chat content — not Markdown prose, not an ASCII sketch, not a
table, not a fenced "wireframe", not a "here's the recap" summary. A recap's
entire value is the hosted, interactive, annotatable plan; an inline summary is
not a recap, it is the thing a recap replaces. The only supported output is to
publish the plan and return its absolute URL.

If the `plan` MCP server's tools are not available, do NOT improvise an inline
recap as a fallback. The usual cause is a connector that did not finish
connecting this session (it registers zero tools), NOT necessarily an auth
problem — so do not assume the user must authenticate. Stop and tell the user
how to restore it: reconnect the plan MCP server (in Claude Code, run `/mcp` and
reconnect, or restart the session); only if it is genuinely unauthenticated, run
`agent-native connect <plan-app-url>` or re-authenticate via `/mcp`. Then publish
once the tool is reachable. Falling back to inline content is a defect, not a
degraded mode.

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

## Recaps Must Be Substantial

Lean is not the same as thin. A recap is not a single wireframe plus one
sentence — that under-serves the reviewer as much as boilerplate prose over-serves
them. Alongside the visual/structural headline (wireframes, `data-model`,
`api-endpoint`, `diagram`), a substantial recap also carries the implementation
evidence:

- A `file-tree` of the changed files with each entry's `change` flag, so the
  reviewer sees the footprint of the work at a glance.
- The split `diff` of the KEY changed files, grouped under a `## Key changes`
  `rich-text` heading in a single vertical `tabs` block (file labels as the left
  rail), with a one-line `summary` and a few `annotations` on each — so the
  reviewer can drop from the high-altitude shape straight into the load-bearing
  code.

Skip the diff appendix only for a genuinely tiny change that reviews faster as
plain diff (see "When To Use"); for any change worth recapping, the file-tree and
key-change diffs belong in the plan.

## UI Impact Needs Wireframes

When the diff changes rendered UI, layout, density, visual state, interaction
affordances, navigation, controls, menus, dialogs, or design tokens, the recap
MUST include one or more wireframes. Prose and file diffs are not a substitute
for showing what changed visually.

Choose the smallest visual surface that makes the review clear:

- Use a `Before` / `After` wireframe pair when the reviewer benefits from direct
  comparison, such as a removed or added control, a changed state, layout
  density, ordering, navigation, or a visible component replacement. The
  Wireframe Quality core below owns how to lay that pair out (columns vs.
  vertical stack by geometry).
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

## Wireframe Quality

UI recap wireframes must look like the UI surface that changed, not like generic
architecture boxes. The following bar is shared, word for word, with
`/visual-plan` and `/ui-plan`: it is the single source of truth for HTML
wireframe quality, and applies to a recap's standalone `wireframe` /
`WireframeBlock` / `<Screen>` exactly as it applies to a plan's canvas artboard.

<!-- SHARED-CORE:wireframe-quality START -->

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

A sidebar popover renders as a small surface, not a desktop page and a phone
frame. Do not emit `desktop` + `mobile` variants unless responsive behavior
actually changes the layout. For a component or widget, show one broader
app-context frame only when placement affects understanding, then the focused
component states.

**Model the actual component shell for small surfaces.** A rendered UI change
belongs in a wireframe; reserve `diagram` for architecture, dependency, state,
or data-flow relationships. Popovers, dropdown menus, command palettes, and
context menus use `surface: "popover"` unless the surrounding page placement is
the point of the change. Dialogs, sheets, inspectors, sidebars, and long
property panels use the matching `panel` / `desktop` surface as appropriate.
Show the real chrome: trigger or anchor when it matters, title/header row,
top-right actions, separators, fields, options, selected states, body content,
and footer actions that are visible in the workflow.

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
to fake a loader.

**Editing an existing mockup.** To change one element, text, or color in an
existing html mockup, do NOT regenerate the frame — call `update-visual-plan`
with `contentPatches: [{ op: "patch-wireframe-html", blockId, edits: [{ find,
replace }] }]`. Each `find` is a unique snippet of the current html (read it
first with `get-visual-plan`); set `all: true` on an edit to replace every
occurrence. The result is re-sanitized.

**Treat the wireframe border as part of the visible design.** Always wrap HTML
wireframe content in a root container with real inner padding before drawing
cards, fields, pills, labels, or controls. Use at least 14-16px of padding,
`box-sizing: border-box`, `height: 100%`, and `gap` between child rows so the
first row never sits flush against the screen border. Keep text away from
borders: every container, field, button, menu item, and annotation needs enough
padding and line-height to read cleanly in the rendered Plan view.

**Lay out children safely so they never collide.** Use HTML flex/grid with
`gap`, `min-width: 0`, and sensible overflow. Avoid negative margins, absolute
positioning, or fixed child widths that can collide when the renderer switches
between light/dark, sketch/clean, or different zoom levels.

**Do not wrap intentionally single-line labels.** For toolbars, tab rails,
breadcrumbs, chip/filter rows, branch and file names, file chips, and code
filenames — any deliberately single-line row — do not let long text wrap. Put
`white-space: nowrap` on the row (and `overflow: hidden; text-overflow: ellipsis`
on the individual labels that can grow), so the wireframe demonstrates the actual
layout behavior instead of producing ugly stacked or vertical text. Use
horizontally scrollable or clipped rails for overflow.

**Fill the frame; keep labels short.** Each artboard is a fixed-size surface — compose enough realistic HTML to fill it top to bottom with even vertical rhythm; never leave a large empty band. On desktop/app-shell sidebars, let the nav stack flex to fill (`flex:1`) and add any persistent bottom action/status after it so the rail reads complete in taller frames. On mobile especially, flow real rows down the whole screen (status bar, header, then list/detail content) rather than a header floating above a gap. Keep every label short enough to sit on one line within its column — shorten the copy rather than relying on the frame to absorb it (long labels wrap or clip).

**Persistent chrome bars span the full frame width.** Top bars, app headers,
toolbars, and bottom tab/nav bars are full-width chrome, not centered content.
Lay each one out as a single flex row that fills the frame
(`style="display:flex;align-items:center;width:100%"`) and push trailing actions
to the right edge with a flex spacer (`<div style="flex:1"></div>`) between the
leading group and the trailing group — never center a bar inside a narrow,
centered block, and never let it collapse to the width of its contents. In a
Before/After pair the bar stays full-width in BOTH states even when one state has
fewer controls; the spacer absorbs the difference so the remaining controls hold
their edge alignment instead of sliding to the center.

**Pin bottom bars to the bottom of the frame.** For mobile tab bars, footers, and
any persistent bottom action row, make the frame itself a flex column at
`height:100%` (`style="display:flex;flex-direction:column;height:100%"`), give the
scrolling body `flex:1` so it absorbs the slack, and place the bar as the LAST
child of the frame (or set `margin-top:auto` on it). The bar then sits flush at
the bottom of the surface instead of floating directly under the content with an
empty band beneath it.

**Before / after must be comparable.** When showing a state change, preserve the
unchanged controls in both states so the reviewer can see exactly what moved or
appeared; do not show an added control as a generic box floating elsewhere in
the surface. Place the new/changed affordance where the implementation puts it —
for example, a new `Edit with AI` action in a popover header belongs in the
top-right header slot, aligned with the title, not in the body or footer. Use
the same frame size, scale, outer padding, border radius, and visual density on
both sides unless the change itself alters those properties, and let the frame
height fit the content rather than leaving a tall empty lower half.

**Name the states with the column header, never inside the frame.** Put the two
states in a `columns` block and set each column's `label` to `Before` and
`After` — the renderer draws that label as an `h4` heading above each frame. Do
NOT bake a `Before`/`After` pill, title, or heading into the wireframe `html`: a
label placed inside reads as part of the product UI, lands in a random corner,
and clutters the comparison. The column header is the one and only place the
state name belongs.

**Let the surface choose side-by-side vs. stacked.** The `columns` renderer lays
narrow surfaces (`mobile`, `popover`, `panel`) out side by side, and
automatically stacks wide surfaces (`desktop`, `browser`) vertically at full
document width so a large frame is never crushed into a half-width column and
cropped. Author both wireframes with the real `surface` and the matching
`Before`/`After` column labels; do not hand-stack the pair into separate
top-level wireframes or duplicate the state name as body content.

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

<!-- SHARED-CORE:wireframe-quality END -->

Use the standard `WireframeBlock` / `<Screen>` format so the Plan viewer owns the
surface frame, theme, and sketchy/clean toggle. HTML wireframes are appropriate
when placement precision matters, especially popovers, menus, dialogs, and dense
forms; kit-tree wireframes are appropriate for simpler layouts. For HTML
wireframes, keep `renderMode` unset or `wireframe` unless a design-only editable
mockup is explicitly required, because `renderMode="design"` disables the
sketchy rough overlay.

Before sharing a UI-impact recap, render it in the Plan viewer and inspect it at
the current theme. If any label, annotation, toolbar, or wireframe content
overlaps another element, fix the MDX and re-import before reporting the link. A
text-match screenshot is not enough; visually inspect the captured image.

## Open And Report The Recap

After creating the recap, link the reviewer to the rendered plan with an
**absolute URL on the origin whose database actually holds the plan**. That
origin is the Plan MCP server you just created the recap through — NOT whatever
dev server you happen to know is running. The create tool returns the correct
link; report THAT. Never make the primary link a local `plan.mdx` file, a local
mirror folder, or a relative path such as `/plans/<id>`.

A recap lives only in the database of the MCP that created it. A separately
running local dev server (e.g. `http://localhost:8081`) has its OWN database and
will NOT contain a recap created through the hosted MCP, so a hand-built
`localhost` link returns "Plan not found". This is the most common recap
mistake — do not guess an origin you have not confirmed shares the MCP's data.

Resolve the URL in this order:

1. Use the absolute URL the create tool RETURNS — `openLink.webUrl`, else the
   `visualUrl` in the returned `plan.mdx` frontmatter, else `url`/`path`
   resolved against the MCP server's own origin (for the hosted MCP that is
   `https://plan.agent-native.com`). This always points at the database that has
   the plan.
2. Use a `localhost`/dev origin ONLY when the recap was created through a Plan
   MCP bound to that same origin — i.e. that MCP's url is
   `http://localhost:<port>/_agent-native/mcp`. Creating through the hosted MCP
   and linking to localhost is the exact mismatch that 404s.
3. If only a plan id is available, build the MCP origin's absolute URL
   (hosted: `https://plan.agent-native.com/plans/<id>`) and say it was inferred.

If the user wants to review on localhost but the recap was created through the
hosted MCP, say so plainly: the local dev server cannot see it. To view a recap
on localhost (e.g. to exercise un-deployed local renderer changes), they must
connect a LOCAL Plan MCP (`http://localhost:<port>/_agent-native/mcp`) and
re-create the recap through it so it lands in the local database; offer to do
that rather than handing over a localhost URL that will not resolve.

When running in Codex and the Browser/in-app side browser tools are available,
open the returned absolute recap URL there automatically after creation. Still
include the same absolute URL in the final response. Local mirror files like
`plans/<slug>/plan.mdx` may be mentioned only as secondary source-control
artifacts, not as the main way to open the recap.

## Diff → Block Mapping

Map each kind of change to the block that carries it, derived mechanically from
the actual diff:

- **Schema / migration change** → `data-model` for the resulting entities,
  fields, and relations. Flag what moved per field/entity with
  `change: "added" | "modified" | "removed" | "renamed"`, and for a changed type
  set `was` to the prior value (e.g. the old column type) — grounded in the real
  migration diff. That diff-aware `data-model` is the headline; reach for a split
  `diff` of the literal SQL only when the exact statement still matters, not by
  default.
- **API / action / route change** → `api-endpoint` with the method, path,
  params, request, and responses as they are after the change. Flag each changed
  param/response with `change` (and `was` on a param whose type/shape changed),
  and set `change` on the endpoint root for a wholly added or removed route. Mark
  removed endpoints with `deprecated: true` and explain in prose.
  Keep multiple API endpoints in the normal single-column document flow unless
  they are an explicit before/after contract comparison.
  Author each request/response example as a SINGLE valid JSON value — one
  top-level object or array, parseable on its own — so it renders in the
  collapsible JSON explorer. Do not put `//` or `/* */` comments, prose,
  trailing commas, or two or more concatenated top-level objects inside one
  example; a non-parseable body falls back to flat text and loses the explorer.
  When an endpoint has several distinct message shapes (for example separate
  websocket frame types, or a success body versus an error body), give each its
  OWN example with its own label rather than cramming them into one body.
- **Compatibility-sensitive change** → short `rich-text` notes beside the
  relevant `data-model` / `api-endpoint` block. Name the changed field,
  endpoint, or behavior and mark whether it is breaking, risky, or non-breaking;
  pair that note with a split `diff` for the literal lines.
- **Any meaningful code hunk** → `diff` with `mode: "split"`, carrying the real
  `before` / `after` text and the `filename` / `language`. Split mode is the
  default for a recap because before/after legibility is the whole point. Give
  every `diff` a one-line `summary` saying what the hunk changes and why; it
  renders as a description above the code so the reviewer reads intent first.
  Never leave a diff unlabeled.
  For the KEY changed files, attach `annotations` to the `diff` so the recap
  calls out what each important hunk does — this is the headline affordance for
  annotating the key files updated. Each annotation is
  `{ side?: "before" | "after"; lines: "13" | "13-15"; label?: string; note }`
  and anchors to the AFTER-side line numbers by default (set `side: "before"` to
  point at removed lines). Keep it to a few high-signal notes per file, not one
  per line.
  When several key files each need a substantial diff, introduce the group with a
  `rich-text` heading block whose markdown is `## Key changes`, then place the
  `diff` blocks under it in a reusable `tabs` block with
  `orientation: "vertical"` so file labels form a left rail and the selected
  file's split diff renders on the right. Let that heading label the section — do
  NOT also set a `title` on the `tabs` block. Keep each tab label to the file
  path or a short basename plus directory hint.
  If the recap ends with more than one supporting diff, that trailing diff
  appendix should be one vertical `tabs` block under its own `## Key changes`
  heading, not a stack of separate `diff` blocks.
- **Brand-new file or a substantial added block with no meaningful "before"** →
  `annotated-code` rather than a one-sided split `diff`. Carry the real new code
  with its `filename` / `language` and anchor a few high-signal notes to the lines
  that matter (`{ lines: "12" | "12-18"; label?; note }`) so the reviewer reads
  what the new code does, not code for code's sake. Keep split `diff` for true
  before/after hunks where the removed lines still carry meaning, and group
  several annotated walkthroughs in a vertical `tabs` block the same way diffs are
  grouped.
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
  `--wf-ok`, and switch to Excalifont plus rough.js outlines in sketchy mode. Do not
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
wireframes when the comparison clarifies the change; use after-only or a state
sequence when that better matches the change. The visual headline must show
exact placement, realistic chrome, and adequate padding before any abstract
explanation. The Wireframe Quality core owns the before/after layout choice —
the `columns` renderer keeps narrow surfaces side by side and auto-stacks wide
`desktop`/`browser` frames vertically; never hand-build a side-by-side
wireframe layout in `custom-html`. For document-body
comparisons, there is no other multi-column primitive — `columns` plus split
`diff` are the whole comparison vocabulary. Do not hand-build side-by-side
layouts in `custom-html`, and do not stack two `data-model` blocks vertically
and call it a comparison when `columns` exists to put them side by side.

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
