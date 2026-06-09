/**
 * `agent-native skills` is the friendly install surface for app-backed skills.
 * The lower-level `app-skill` commands remain the packaging primitives; this
 * command handles the common "install Assets for my agent" path in one step.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildAppSkillPack,
  ensureAppSkill,
  loadAppSkillManifest,
  normalizeAppSkillManifest,
  type AppSkillManifest,
  type LoadedAppSkillManifest,
} from "./app-skill.js";
import {
  readConnectClientPreferences,
  resolveClients,
  runConnect,
  writeConnectClientPreferences,
} from "./connect.js";
import {
  CONTEXT_XRAY_SKILL_MD,
  installLocalContextXray,
} from "./context-xray-local.js";
import { CLIENTS, type ClientId } from "./mcp-config-writers.js";
import { PR_VISUAL_RECAP_SETUP, writePrVisualRecapWorkflow } from "./recap.js";

const HELP = `agent-native skills

Usage:
  agent-native skills list
  agent-native skills add assets|design-exploration|visual-plan|visual-recap|context-xray [--client codex|claude-code|claude-code-cli|cowork|all] [--scope user|project] [--mcp-url <url>] [--no-connect] [--with-github-action] [--yes] [--dry-run] [--json]
  agent-native skills add <manifest-or-app-dir> [--client ...] [--yes]

Examples:
  agent-native skills add assets
  agent-native skills add design-exploration
  agent-native skills add visual-plan
  agent-native skills add visual-plan --with-github-action
  agent-native skills add visual-plan --no-connect
  agent-native skills add context-xray --client all
  agent-native skills add assets --client claude-code
  agent-native skills add assets --mcp-url https://my-app.ngrok-free.dev
  agent-native skills add ./dist/assets-skill --client codex

The add command installs the SKILL.md instructions, registers the app-backed
MCP connector, and then authenticates it in one step so you do not hit an OAuth
wall on the first tool call. Authentication reuses "agent-native connect":
OAuth-capable clients (Claude Code) get a URL-only entry and a /mcp authenticate
prompt, while Codex / Cowork run the browser device-code flow. In a
non-interactive shell or CI the auth step is skipped and the exact
"agent-native connect <url>" command is printed instead.

Running "npx skills add ..." directly installs instructions only; use this Agent
Native CLI path when you want MCP setup and auth too. Pass --no-connect to
register the connector without authenticating (leave auth to the host or run
"agent-native connect" later). Pass --mcp-url to register that connector against
a custom origin (an ngrok tunnel, a local dev server, or a self-hosted
deployment) instead of the built-in hosted default — a bare origin gets the
standard /_agent-native/mcp path appended. Use app-skill pack for marketplace
bundles and custom adapter output.`;

const ASSETS_SKILL_MD = `---
name: assets
description: >-
  Use Assets for image or video generation requests, brand-safe media,
  human picker UI, search/list/export actions, and cross-app asset selection.
  Prefer this over generic image tools when installed.
metadata:
  visibility: exported
---

# Assets

Use the Assets app when a workflow needs reusable brand media, a human picker,
or generated image/video assets that another app can reference by ID and URL.
When this skill is available, route plain image-generation requests here instead
of using a generic image generator.

## Choose The Path

- Use \`open-asset-picker\` when a person should browse, search, generate, and
  select an asset in UI. Pass \`mediaType: "image"\` by default, or
  \`mediaType: "video"\` for video libraries. When the user asks to create a
  specific image and choose the best option, pass \`prompt\`,
  \`autoGenerate: true\`, and \`count: 3\` so the picker opens with candidates
  to preview and select.
- Use unattended actions when the agent already knows what to do:
  \`search-assets\`, \`list-assets\`, \`generate-image\`,
  \`generate-image-batch\`, \`generate-video\`,
  \`refresh-generation-run\`, and \`export-asset\`.
- Use browser/deep-link fallback when the host cannot render MCP Apps inline.
  Surface the returned picker link. If it opens in a normal browser tab, have
  the user select an asset there and paste back the copied handoff summary.
  Treat Codex, Claude Code, and Claude Desktop Code as link-out hosts; do not
  promise inline MCP App rendering there.
  If the skill instructions are available but the MCP tool namespace has not
  appeared yet, use the Assets browser fallback URL shape instead of switching
  to a generic generator:
  \`https://assets.agent-native.com/library?mediaType=image&prompt=...&autoGenerate=1&count=3\`.
  When reporting the final selected image in Codex or Claude Code, include the
  asset link and, if an inline preview is important, download the selected
  \`previewUrl\`/\`downloadUrl\` to a local temp image and embed that absolute
  local path. Remote CDN markdown images can fail to render in code-editor chat
  surfaces.

## Image And Video Workflows

1. Pick or match the library with \`list-libraries\` or \`match-library\`.
2. For images, call \`generate-image\` or \`generate-image-batch\`. Image
   actions are synchronous: one batch call should return the finished image
   candidates, so do not poll or regenerate unless a returned slot failed.
3. For videos, call \`generate-video\` and poll \`refresh-generation-run\`
   until the run completes.
4. Preserve returned \`assetId\`, \`runId\`, \`previewUrl\`, \`downloadUrl\`,
   media type, and dimensions so the caller can attach or embed the result.

## Cross-App Use

- Hosted default: connect \`https://assets.agent-native.com/_agent-native/mcp\`.
  Do not put shared secrets in skill files.
- For CLI/code-editor clients, keep any \`agent-native connect\` command
  running until browser authorization finishes. Stopping it early can leave the
  browser approved but the local MCP config unwritten. Restart or reload the
  agent client after installing or connecting if Assets tools do not appear in
  the live session.
- Local customization: use \`agent-native app-skill launch --local\` from an
  Assets app-skill manifest, or pass \`--into <path>\` for editable source.
- Do not call image/video providers directly from another app. Assets owns
  generation, picker UI, search/list/export, and asset context.
- If an Assets tool call returns \`Session terminated\`, \`needs auth\`, or
  another connector/session error, do not keep retrying the tool. Tell the user
  to reconnect or authenticate the Assets MCP connector, then continue after it
  is available.
- Do not hand-roll MCP HTTP requests with curl from the agent session. Use the
  host-exposed Assets tools after restart/reload, or use the returned
  browser/deep-link fallback.
- If a batch image generation request times out in browser fallback, retry with
  \`count: 1\` only after telling the user the multi-candidate request timed out.
- If you inspect local MCP config, redact \`Authorization\`, \`http_headers\`,
  and token values. Never paste bearer tokens into chat or logs.
`;

const DESIGN_EXPLORATION_SKILL_MD = `---
name: design-exploration
description: >-
  Use Design for UI/UX exploration, side-by-side design directions,
  interactive prototype previews, user selection, iteration, and design-to-code
  handoff through the hosted Design MCP app.
metadata:
  visibility: exported
---

# Design Exploration

Use the Design app when a workflow needs visual UI exploration, prototype
iteration, or a human-in-the-loop choice among design directions.

## Choose The Path

- Use \`create-design\` first to create a project shell. Do not report the
  design as ready until it has renderable HTML.
- For open-ended UX exploration, generate distinct, complete HTML directions
  (2-5, three by default) and call \`present-design-variants\`. The inline
  Design MCP app shows the options, lets the user pick one, and persists the
  selected variant.
- If the Design app opens as a browser link instead of inline (CLI hosts like
  Codex / Claude Code, where the deep link carries \`handoff=chat\`), the user
  picks a direction there and the editor shows a copyable summary — ask them to
  paste it back into chat so you can continue from the chosen direction. The
  \`present-design-variants\` result's \`fallbackInstructions\` describe this.
- For direct refinements to an already chosen direction, call
  \`get-design-snapshot\`, edit from the current tuned HTML, then call
  \`generate-design\`.
- Use \`export-coding-handoff\` when the user wants to implement the chosen
  design in a codebase.

## Exploration Defaults

1. Default to three variants unless the user asks for a different count
   (\`present-design-variants\` accepts 2-5; three is the sweet spot).
2. Make variants structurally and stylistically distinct, not just color swaps.
3. Each variant must be a complete standalone HTML document that renders
   without a build step.
4. For product UI redesigns, prefer cleaner hierarchy, progressive disclosure,
   and realistic controls over decorative mockups.
5. After \`present-design-variants\`, wait for the user's pick before
   generating the next version. If they say "I like #2 but...", snapshot the
   chosen design and refine that direction with \`generate-design\`.

## Cross-App Use

- Hosted default: connect \`https://design.agent-native.com/_agent-native/mcp\`.
  Do not put shared secrets in skill files.
- For CLI/code-editor clients, keep any \`agent-native connect\` command
  running until browser authorization finishes. Stopping it early can leave the
  browser approved but the local MCP config unwritten. Restart or reload the
  agent client after installing or connecting if Design tools do not appear in
  the live session.
- Dispatch can expose Design alongside other apps. Use Design for UI/UX design
  tasks, Assets for image/media selection, Slides for decks, and so on.
- Keep the loop visual: surface the inline MCP App or the returned "Open
  design" link instead of pasting large HTML blobs into chat.
- If a Design tool call returns \`Session terminated\`, \`needs auth\`, or
  another connector/session error, do not keep retrying the tool. Tell the user
  to reconnect or authenticate the Design MCP connector, then continue after it
  is available.
- Do not hand-roll MCP HTTP requests with curl from the agent session. Use the
  host-exposed Design tools after restart/reload, or use the returned
  browser/deep-link fallback.
- If you inspect local MCP config, redact \`Authorization\`, \`http_headers\`,
  and token values. Never paste bearer tokens into chat or logs.
`;

/**
 * Shared setup/auth block for every Plans skill (`/visual-plan`,
 * `/visual-recap`, `/ui-plan`, `/prototype-plan`, `/plan-design`,
 * `/visual-questions`). Interpolated into each skill markdown
 * so the install + one-step authenticate instructions never drift between them.
 * Keep this in sync with the copies under `templates/plan/.agents/skills/*` and
 * top-level `skills/*` (this skill's SKILL.md is triplicated with no sync test).
 */
const PLAN_SETUP_AUTH_MD = `## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and
authenticates it in the same step (a one-time browser sign-in at setup — this is
intended), so the first tool call does not hit an OAuth wall:

\`\`\`bash
agent-native skills add visual-plan
\`\`\`

After that, \`/visual-plan\` (and \`/visual-recap\`, \`/ui-plan\`,
\`/prototype-plan\`, \`/plan-design\`, \`/visual-questions\`) generate a plan and open
the editor. Pass \`--no-connect\` to
register the connector without authenticating, then run
\`agent-native connect https://plan.agent-native.com\` whenever you are ready.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns \`needs auth\`, \`Unauthorized\`, or \`Session terminated\`,
do not keep retrying the tool. Authenticate the connector with
\`agent-native connect https://plan.agent-native.com\` (OAuth-capable hosts can
instead re-run /mcp and choose Authenticate), then continue once the connector
is available.

Hosted default: connect \`https://plan.agent-native.com/_agent-native/mcp\`. Do
not put shared secrets in skill files.`;

// Single-source shared cores. Each partial is a heading-less BODY string that
// begins and ends with its own SHARED-CORE marker comment, so the marker-region
// sync guard can extract and compare it across the skills that consume it. The
// skill constants below interpolate these partials at module-eval time; the
// distributed artifact stays a flat string, so distribution is unchanged.
//
// Consumers:
//   WIREFRAME_QUALITY_CORE  — visual-plan, ui-plan, visual-recap (surface-agnostic)
//   CANVAS_SURFACE_CORE     — visual-plan, ui-plan (canvas/artboard mechanics)
//   DOCUMENT_QUALITY_CORE   — visual-plan, ui-plan
//   EXEMPLAR_CORE           — visual-plan, ui-plan

// Surface-agnostic HTML wireframe quality rules. Applies equally to a standalone
// WireframeBlock/<Screen> (visual-recap) and to a canvas artboard (visual-plan /
// ui-plan). Do not put canvas/artboard placement mechanics here.
const WIREFRAME_QUALITY_CORE = `<!-- SHARED-CORE:wireframe-quality START -->

**A wireframe is an HTML mockup. The renderer owns the look; you write the
content.** Set \`data.html\` to a self-contained, semantic HTML fragment of the
screen and set \`data.surface\`. The renderer owns the surface footprint/aspect,
the dark/light theme, the hand-drawn font, and the rough.js sketch overlay — you
never write \`<html>\`/\`<body>\`/\`<script>\`/\`<style>\` tags, font-family, hex colors,
or any width/height/coordinates. You write real HTML layout and real product
content; the renderer styles and roughens it.

**A wireframe block's data is an HTML screen plus a surface:**

\`\`\`json
{
  "surface": "browser",
  "html": "<div style=\\"display:flex;flex-direction:column;gap:10px;padding:16px;height:100%\\"><h1>Sign in</h1><p class=\\"wf-muted\\">Use your work email to continue.</p><div class=\\"wf-card\\" style=\\"display:flex;flex-direction:column;gap:10px\\"><label>Email<input value=\\"jane@acme.co\\" /></label><label>Password<input value=\\"••••••••\\" /></label><label style=\\"display:flex;align-items:center;gap:8px\\"><input type=\\"checkbox\\" checked /> Remember me</label><button class=\\"primary\\">Sign in</button></div><a href=\\"#\\">Forgot password?</a></div>"
}
\`\`\`

**Write PLAIN semantic HTML and let the renderer style it.** Bare elements
(\`h1\`/\`h2\`/\`h3\`, \`p\`, \`button\`, \`input\`, \`<input type="checkbox">\`, \`a\`, \`hr\`)
are auto-themed — no classes needed. Helper classes carry the rest:

- \`.wf-card\` / \`.wf-box\` — a bordered, padded container (a panel, a list item).
- \`.wf-pill\` / \`.wf-chip\` — a rounded tag or filter; add \`.accent\`
  (\`<span class="wf-pill accent">\`) for the accent-filled variant.
- \`.wf-muted\` — secondary/muted text (or use \`<small>\`).
- \`button.primary\` or any element with \`[data-primary]\` — the accent-filled
  primary button.

**Use the \`--wf-*\` tokens for any custom color, never hex.** The renderer flips
these on light/dark, so reading them is what keeps a mockup correct in both
themes. For any inline border, background, or text color, reference a token:
\`style="border:1.4px solid var(--wf-line)"\`. The tokens are \`--wf-ink\` (text),
\`--wf-muted\` (secondary text), \`--wf-line\` (borders/dividers), \`--wf-paper\`
(page background), \`--wf-card\` (raised surface), \`--wf-accent\` /
\`--wf-accent-fg\` / \`--wf-accent-soft\` (brand action), \`--wf-warn\`, \`--wf-ok\`,
and \`--wf-radius\`. Never hard-code a hex color and never set \`font-family\` — the
renderer owns the sketch/clean font.

**Lay out with inline \`style\` flex/grid.** You write the real layout —
\`display:flex; flex-direction:column; gap:10px; padding:16px\` and so on — and the
renderer never repositions anything. Compose the actual product: reproduce the
current screen, then show the modification. Real labels, real counts, real dates,
real button text grounded in the screen you read; not lorem or gray bars.

**Surface presets — match the real footprint, never default to desktop+mobile.**
Pick the \`surface\` that matches what the user will actually see:

- \`browser\`: a web page that needs a browser chrome frame around it.
- \`desktop\`: a full desktop app page or app shell.
- \`mobile\`: a phone screen, only when the work is genuinely mobile.
- \`popover\`: a small floating menu, dropdown, or inline popover.
- \`panel\`: a side panel, inspector, or sidebar widget.

A sidebar popover renders as a small surface, not a desktop page and a phone
frame. Do not emit \`desktop\` + \`mobile\` variants unless responsive behavior
actually changes the layout. For a component or widget, show one broader
app-context frame only when placement affects understanding, then the focused
component states.

**Model the actual component shell for small surfaces.** A rendered UI change
belongs in a wireframe; reserve \`diagram\` for architecture, dependency, state,
or data-flow relationships. Popovers, dropdown menus, command palettes, and
context menus use \`surface: "popover"\` unless the surrounding page placement is
the point of the change. Dialogs, sheets, inspectors, sidebars, and long
property panels use the matching \`panel\` / \`desktop\` surface as appropriate.
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
separate artboard whose \`html\` contains ONLY that sub-surface — do not re-draw
the whole page around it, and do not scale a duplicate up. Pick the matching
\`surface\` (e.g. \`popover\`) so the footprint is right; never widen a popover to
page width.

**Loading / skeleton states.** Set \`data.skeleton: true\` on the wireframe and
fill the \`html\` with neutral, textless placeholder geometry — boxes and bars
built as \`<div>\`s with \`background:var(--wf-line)\` and explicit heights/widths,
no labels or copy. The renderer drops borders, sketch, and color into the
skeleton register automatically. Never escape to a \`custom-html\` document block
to fake a loader.

**Editing an existing mockup.** To change one element, text, or color in an
existing html mockup, do NOT regenerate the frame — call \`update-visual-plan\`
with \`contentPatches: [{ op: "patch-wireframe-html", blockId, edits: [{ find,
replace }] }]\`. Each \`find\` is a unique snippet of the current html (read it
first with \`get-visual-plan\`); set \`all: true\` on an edit to replace every
occurrence. The result is re-sanitized.

**Treat the wireframe border as part of the visible design.** Always wrap HTML
wireframe content in a root container with real inner padding before drawing
cards, fields, pills, labels, or controls. Use at least 14-16px of padding,
\`box-sizing: border-box\`, \`height: 100%\`, and \`gap\` between child rows so the
first row never sits flush against the screen border. Keep text away from
borders: every container, field, button, menu item, and annotation needs enough
padding and line-height to read cleanly in the rendered Plan view.

**Lay out children safely so they never collide.** Use HTML flex/grid with
\`gap\`, \`min-width: 0\`, and sensible overflow. Avoid negative margins, absolute
positioning, or fixed child widths that can collide when the renderer switches
between light/dark, sketch/clean, or different zoom levels.

**Do not wrap intentionally single-line labels.** For toolbars, tab rails,
breadcrumbs, chip/filter rows, branch and file names, file chips, and code
filenames — any deliberately single-line row — do not let long text wrap. Put
\`white-space: nowrap\` on the row (and \`overflow: hidden; text-overflow: ellipsis\`
on the individual labels that can grow), so the wireframe demonstrates the actual
layout behavior instead of producing ugly stacked or vertical text. Use
horizontally scrollable or clipped rails for overflow.

**Fill the frame; keep labels short.** Each artboard is a fixed-size surface — compose enough realistic HTML to fill it top to bottom with even vertical rhythm; never leave a large empty band. On desktop/app-shell sidebars, let the nav stack flex to fill (\`flex:1\`) and add any persistent bottom action/status after it so the rail reads complete in taller frames. On mobile especially, flow real rows down the whole screen (status bar, header, then list/detail content) rather than a header floating above a gap. Keep every label short enough to sit on one line within its column — shorten the copy rather than relying on the frame to absorb it (long labels wrap or clip).

**Persistent chrome bars span the full frame width.** Top bars, app headers,
toolbars, and bottom tab/nav bars are full-width chrome, not centered content.
Lay each one out as a single flex row that fills the frame
(\`style="display:flex;align-items:center;width:100%"\`) and push trailing actions
to the right edge with a flex spacer (\`<div style="flex:1"></div>\`) between the
leading group and the trailing group — never center a bar inside a narrow,
centered block, and never let it collapse to the width of its contents. In a
Before/After pair the bar stays full-width in BOTH states even when one state has
fewer controls; the spacer absorbs the difference so the remaining controls hold
their edge alignment instead of sliding to the center.

**Pin bottom bars to the bottom of the frame.** For mobile tab bars, footers, and
any persistent bottom action row, make the frame itself a flex column at
\`height:100%\` (\`style="display:flex;flex-direction:column;height:100%"\`), give the
scrolling body \`flex:1\` so it absorbs the slack, and place the bar as the LAST
child of the frame (or set \`margin-top:auto\` on it). The bar then sits flush at
the bottom of the surface instead of floating directly under the content with an
empty band beneath it.

**Before / after must be comparable.** When showing a state change, preserve the
unchanged controls in both states so the reviewer can see exactly what moved or
appeared; do not show an added control as a generic box floating elsewhere in
the surface. Place the new/changed affordance where the implementation puts it —
for example, a new \`Edit with AI\` action in a popover header belongs in the
top-right header slot, aligned with the title, not in the body or footer. Use
the same frame size, scale, outer padding, border radius, and visual density on
both sides unless the change itself alters those properties, and let the frame
height fit the content rather than leaving a tall empty lower half.

**Name the states with the column header, never inside the frame.** Put the two
states in a \`columns\` block and set each column's \`label\` to \`Before\` and
\`After\` — the renderer draws that label as an \`h4\` heading above each frame. Do
NOT bake a \`Before\`/\`After\` pill, title, or heading into the wireframe \`html\`: a
label placed inside reads as part of the product UI, lands in a random corner,
and clutters the comparison. The column header is the one and only place the
state name belongs.

**Let the surface choose side-by-side vs. stacked.** The \`columns\` renderer lays
narrow surfaces (\`mobile\`, \`popover\`, \`panel\`) out side by side, and
automatically stacks wide surfaces (\`desktop\`, \`browser\`) vertically at full
document width so a large frame is never crushed into a half-width column and
cropped. Author both wireframes with the real \`surface\` and the matching
\`Before\`/\`After\` column labels; do not hand-stack the pair into separate
top-level wireframes or duplicate the state name as body content.

**Good example — a contacts list, surface \`browser\`.** A small, real screen
composed from the helper classes and tokens, layout in inline flex, no fonts or
hex colors:

\`\`\`html
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
\`\`\`

<!-- SHARED-CORE:wireframe-quality END -->`;

// Canvas/artboard placement mechanics. Used only by visual-plan and ui-plan
// (visual-recap renders standalone wireframes, not a canvas).
const CANVAS_SURFACE_CORE = `<!-- SHARED-CORE:canvas-surface START -->

**Artboard placement is locked by the \`surface\`, not by coordinates.** The
surface locks the footprint and aspect; never set artboard width/height and
never use coordinates inside the wireframe HTML. Let canvas auto-placement
handle simple one-row boards. For mixed-footprint canvases, board-level artboard
\`x\`/\`y\` is allowed and expected when it creates clear lanes.

**Lay out mixed canvases in lanes.** When a canvas contains broad browser /
desktop frames plus compact \`mobile\`, \`popover\`, or \`panel\` surfaces, do not put
everything in one horizontal strip. Use board-level artboard \`x\`/\`y\` to reserve
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
frame it explains with \`targetId\` + \`placement\` (top/right/bottom/left), and
omit \`type\` or use \`type: "note"\`. The renderer parks notes in a gutter beside
the frame and lays them out automatically. Do not use \`type: "callout"\`,
\`type: "text"\`, \`type: "arrow"\`, x/y, or points for ordinary notes; those are
freeform review-markup layers and must be reserved for intentional markup in
open canvas space. Reserve arrows for a note that must point at one specific
control inside a frame; a note that simply sits beside its frame needs no arrow.

**Patching.** Edit one wireframe, canvas annotation, diagram, or block with targeted \`contentPatches\`
(for example \`patch-wireframe-html\`, \`patch-diagram-html\`, \`update-block\`,
\`replace-blocks\`, \`update-canvas-annotation\`) rather
than regenerating the whole plan. \`contentPatches\` are part of the public MCP
action schema, so Claude Code, Codex, Cursor, and other hosts can make surgical
edits. If an agent is working from exported source files, use
\`read-visual-plan-source\` / \`patch-visual-plan-source\`: \`plan.mdx\` holds
frontmatter plus markdown/document blocks, \`canvas.mdx\` holds
\`<DesignBoard>/<Section>/<Artboard>/<Screen>/<Annotation>/<Connector>\`, and the
patch action normalizes the MDX back into the same JSON runtime model. JSON is
the canonical runtime shape; MDX is the repo-friendly authoring/export surface.
In the browser, humans edit \`rich-text\` prose inline; agents should still use
\`update-rich-text\` content patches or source patches for prose, and use
comments/structured patches for canvas, artboard, wireframe, and diagram edits.

**Never emit a titled artboard with no interior wireframe content.** Every artboard
you place on the canvas must carry an \`html\` wireframe or reference a wireframe
block via \`blockId\`; when using \`blockId\`, the referenced \`wireframe\` /
\`legacy-wireframe\` block must remain in the plan. If you remove a duplicate
wireframe from the document body, first move its \`data\` inline onto the
corresponding \`content.canvas.frames[*].wireframe\` / \`legacyWireframe\`. A
label-only frame or a frame pointing at a deleted block renders empty and is
rejected at parse time. If you only have a title, write it as a section header or
annotation, not an empty artboard.

**UI mockups belong in the top visual review area.** Static UI/product visuals
live on the canvas; multi-step UI flows get both canvas wireframes and a
prototype. When the user asks for a mockup, UI state, loading state, layout,
screen, or visual comparison, make the canvas the primary home for that static
visual. When the user asks for a prototype or the plan contains a sequence the
reviewer must feel, keep the canvas artboards and add \`content.prototype\` so the
top surface shows Wireframes / Prototype tabs. Architecture/code diagrams are
different: keep them inline in the document, close to the recommendation they
support, unless the user explicitly asks for a spatial board. Document blocks
can explain, compare, or map implementation, but they should not host the
primary UI mockup or prototype just because \`custom-html\`, screenshots, or prose
are easier to produce. If the canvas/prototype surface cannot represent the
requested UI fidelity, still keep the closest top-surface representation and
call out or extend the needed renderer capability. A skeleton/loading mockup
also lives in a canvas artboard — never move a mockup out of the canvas.

**Legacy kit tree.** Older plans set a \`screen\` array of \`{ el, ...props }\` kit
nodes instead of \`html\`; the renderer still accepts and displays it, but new
plans emit \`html\`. Do not author fresh kit-tree screens - write the HTML mockup
instead. Likewise, old or imported plans may carry coordinate-based regions or
free-float x/y on notes; those are legacy escape hatches the renderer still
shows but you must never produce. The \`surface\` drives each artboard's aspect
and footprint, and the gutter parks notes by \`targetId\` + \`placement\`. The only
new-plan coordinate exception is deliberate board-level artboard \`x\`/\`y\` for
multi-lane mixed-surface canvases; never supply artboard width/height, note
coordinates, or wireframe-internal coordinates.

<!-- SHARED-CORE:canvas-surface END -->`;

const DOCUMENT_QUALITY_CORE = `<!-- SHARED-CORE:document-quality START -->

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
carry its own nearby inline \`diagram\` / \`data-model\` block plus file evidence
and terse Problem/Solution/Why text. For architecture/code diagrams, prefer
standard two-dimensional layouts: paired before/after panels, layered diagrams,
swimlanes, dependency maps, matrices, or grouped regions. Do not default to
left-to-right chains; use a line only when the relationship is truly a sequence.
Use native \`diagram\` blocks with \`data.html\` / \`data.css\` for these richer
layouts; the fragment may use semantic HTML and inline SVG, and the renderer
applies the viewer's sketch/clean style. Leave room for the sketch font: keep
labels short, give nodes generous width, and place boundary/annotation labels in
unused space instead of over nodes. For small text/SVG changes to an existing
HTML diagram, use \`patch-diagram-html\` with a unique \`find\`/\`replace\` snippet
instead of resending the whole \`data.html\` string. Legacy \`nodes\` / \`edges\` are
only for tiny previews or genuinely linear step flows. Repeat a wireframe in the document only
for a genuinely new detail view or comparison. Skip the visual surface entirely
for non-visual work and write a clean rich document. For a simple binary UI
visual choice, show the two directions in the canvas only; do not repeat the
same options as body wireframes or prose. Put the actual
choice in the bottom "Open Questions" form.

**Use the right block, and make it carry substance.** For the authoritative,
machine-checked list of block types and their data schemas, call \`get-plan-blocks\`
— it returns the live registry vocabulary (type, MDX tag, placement, key fields)
so you never emit a block the editor cannot render or round-trip:

- \`rich-text\` for plan prose with real bold/italic/code/links and nested lists.
- \`annotated-code\` for the file map: when a load-bearing file is worth
  highlighting, prefer the annotated walkthrough over a bare \`code\` block — carry
  the real, syntax-highlighted code AND anchor short margin notes to the lines
  that actually change (the new action, the changed schema, the wiring point), so
  the reader sees what matters and why instead of code for code's sake. Each
  annotation is \`{ lines: "12" | "12-18"; label?; note }\`; keep a few high-signal
  notes per file, not one per line. Highlight only the files worth reading; never
  an exhaustive list of every touched file, and never a prose-only description of
  a file. Drop to a plain \`code\` block only for a throwaway snippet with nothing
  to call out. When more than one file matters, group the blocks in a vertical
  \`tabs\` block (the standard tab primitive) rather than a bespoke container. If
  the exact code is unknown, show the smallest plausible planned shape or a
  commented stub naming what to fill in. (\`code-tabs\` and \`implementation-map\`
  are legacy: their renderers stay for old plans, but do not author new ones.)
- For a decision: if the reviewer must still pick between a genuinely-open
  either/or, put it in the bottom Open Questions \`question-form\` as a \`single\`
  question — one option per real alternative, each with a short detail and
  \`recommended: true\` on the one you would choose; do not also restate the same
  choice elsewhere. If you have already committed to an approach, state it as
  settled prose or a \`callout\` with \`tone="decision"\`, optionally with a
  \`columns\` block for a side-by-side comparison of the options you weighed — not
  as a confusing mid-document form for a question you have already answered.
- \`columns\` for side-by-side before/after or current/target comparisons where
  each side needs real nested blocks; label the columns clearly and avoid
  stacking comparison blocks vertically when parallel reading is the point.
- \`diagram\` for two-dimensional architecture, dependency, data-flow, or state
  relationships, only when it clarifies something real. For architecture/code
  diagrams, prefer \`data.html\` / \`data.css\` with semantic HTML and inline SVG so
  the diagram can use panels, layers, matrices, arrows, annotations, and
  responsive layout directly. Author diagram HTML with renderer-owned primitives
  like \`.diagram-panel\`, \`.diagram-card\`, \`.diagram-node\`, \`.diagram-box\`,
  \`.diagram-pill\`, \`.diagram-muted\`, and \`[data-rough]\`; they map to the plan's
  Tailwind theme variables through \`--wf-ink\`, \`--wf-muted\`, \`--wf-line\`,
  \`--wf-paper\`, \`--wf-card\`, \`--wf-accent\`, \`--wf-accent-soft\`, \`--wf-warn\`, and
  \`--wf-ok\`, and switch to Excalifont plus rough.js outlines in sketchy mode. Do not
  set \`font-family\` and do not hard-code hex, rgb, or hsl colors in diagram HTML
  or CSS. Use legacy \`nodes\` / \`edges\` only for small previews or truly
  sequential flows. In architecture/code plans, prefer a repeated section rhythm:
  recommendation title, confidence and category badges, code-path evidence, a
  local before/after or current/target spatial diagram, then concise
  Problem/Solution/Why text. Labels must not overlap nodes, connectors, or each
  other.
- \`tabs\` for multiple states, directions, or comparisons. A tab that reveals
  only prose usually means the plan is under-specified — include a relevant
  visual unless the tab is intentionally document-only.
- \`table\`, \`checklist\`, \`callout\` for scannable structure.

**Open questions live at the bottom as a form when answers would change the
plan.** Surface answerable unresolved decisions in a final \`question-form\`
block titled "Open Questions" so the renderer presents it as a distinct section.
That bottom form is the ONLY place that enumerates the open questions: never add
a second "Open Questions" heading, list, or recap of the same questions earlier
in the document. A one-line pointer in the overview prose ("a few decisions are
still open — see Open Questions below") is fine, but do not reproduce the
question list or a parallel questions/decisions section above it.
Use \`single\` or \`multi\` for clear choices, \`freeform\` for constraints,
\`recommended: true\` for the default you would pick, and option \`wireframe\` /
\`diagram\` previews only when the options are not already visible in the top
canvas. \`single\` and \`multi\` questions always render a write-in field so a
reviewer can answer with a custom option — never add an explicit "Other" option
yourself; set \`allowOther: false\` only when a free-text answer makes no sense.
Keep non-answerable assumptions or risks as concise \`callout\` blocks in
the relevant section. Never bury a questions/decisions wall inside the plan
narrative, and never ask the same question twice.

**\`custom-html\` is a bounded escape hatch only** — a single complete fragment
inside a block, never \`html\`/\`head\`/\`body\`/\`script\` tags, never a generic
placeholder, density demo, or proof that custom HTML works. Prefer the native
blocks for normal plans. For architecture/code reviews, use \`diagram\`
\`data.html\` / \`data.css\` for rich local HTML/SVG diagrams instead of
\`custom-html\`. For UI/product work, \`custom-html\` is never the primary home for a
requested mockup, UI state, or visual comparison. If UI fidelity requires
HTML/CSS, image capture, or real React/CSS, the product fix is canvas support
for that artifact type, not moving the mockup into the document.

**Before handoff, open the plan and check it.** Fix overlap, excessive
whitespace, clipped fragments, misleading inactive controls, poor contrast, and
unreadable diagrams before asking for approval.

<!-- SHARED-CORE:document-quality END -->`;

const EXEMPLAR_CORE = `<!-- SHARED-CORE:exemplar START -->

**GOOD.** A \`/ui-plan\` for a todo app: a canvas with a \`desktop\` artboard whose
\`data.html\` is a real flex layout — a sidebar of links (\`Inbox 12\`, \`Today 4\`,
\`Done\`), a main column with an \`<h1>Today</h1>\`, accent \`.wf-pill\`s for the
filters, a muted section label \`OVERDUE\`, and \`.wf-card\` task rows carrying real
titles, due dates, and a primary \`button.primary\` — styled only through bare
elements, helper classes, and \`--wf-*\` tokens, so the renderer applies the
correct desktop footprint, theme, and one subtle whole-frame wobble. Plain-text
designer notes sit spaced off the frame, pointing only at the controls that need
explanation. Below it, a Claude/Codex-grade document: objective and
done-criteria, a few \`code\` blocks (grouped in a vertical \`tabs\` block when
more than one) showing the real shape of the load-bearing files, a \`callout\`
with \`tone="decision"\` stating the chosen approach with a \`columns\` block
weighing the two real options behind it,
and a validation step — none of it repeating the canvas. If the task also
changes a multi-step completion flow, the same top area includes a Prototype tab
whose screens use the same labels and states as the canvas artboards, with
\`data-goto\` controls for the sequence. This is the bar.

**GOOD.** A \`/visual-plan\` for a backend architecture review: no top canvas.
The document opens with context and a legend, then repeats recommendation cards:
title, confidence/category badges, a monospace grid of real file paths, one
inline two-dimensional before/after or layered architecture diagram, and terse
Problem/Solution/Why bullets using the codebase's vocabulary. The diagram uses
space to show boundaries, layers, and ownership; it is not a default
left-to-right chain. The plan ends with a top recommendation and a bottom
question-form only if the next architecture direction is genuinely open. This is
better than a top canvas because each diagram is local to the claim it supports.

**BAD.** A \`data.html\` with hard-coded hex colors, a \`font-family\`, or fixed
pixel width/height; gray placeholder bars "insinuating" text on a non-skeleton
frame; a forced desktop + mobile pair for a popover; floating bordered
annotation cards hugging the frames; a fresh hand-authored kit-tree \`screen\`
instead of \`html\`; a multi-step UI flow with only static frames and no prototype
tab; a mockup escaped into a document \`custom-html\` block; and a marketing-style
document with a hero heading and value props that just restates what the canvas
already shows. Also bad: an architecture-only plan forced into a top canvas of
labeled boxes with overlapping text, where the actual code evidence and
recommendations live elsewhere. Never produce this.

<!-- SHARED-CORE:exemplar END -->`;

export const VISUAL_PLANS_SKILL_MD = `---
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

\`/visual-plan\` is the canonical command and the main entry point. Use \`/ui-plan\`
when the work is primarily product UI and review should start with the screens.
Use \`/prototype-plan\` when review should start with a functional live prototype.
Use \`/plan-design\` when review should start with full-fidelity branded design.
Use \`/visual-questions\` only when the user explicitly wants a visual intake form
before planning. When a Codex, Claude Code, Markdown, or pasted plan already
exists, \`/visual-plan\` uses that source plan as the starting point and builds
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
  inventing them. Check existing \`actions/\` before proposing endpoints and prefer
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
  questions before finalizing. Do not call \`create-visual-questions\` from
  \`/visual-plan\`; keep any answerable follow-up inside the plan itself as a
  bottom \`question-form\` Open Questions block. Otherwise state the assumption
  explicitly and proceed, and put anything unresolved in an open-questions block.
- **The plan is the approval gate.** After surfacing it, ask the user to review
  and approve before you write code, and name which files/areas the work touches.
  Presenting the plan and requesting sign-off is the approval step — do not ask a
  separate "does this look good?" question.
- **The document is the source of truth, not the chat.** When scope shifts,
  update the plan with \`update-visual-plan\` rather than only changing course in
  chat, and re-read the approved plan before major steps.

## Core Workflow

1. Follow the host agent's normal planning flow: inspect the codebase, delegate
   wide exploration when useful, gather the info needed, and ask native
   clarifying questions as needed before generating the plan. If a source plan
   already exists, gather its exact text from the user's paste, a referenced
   file, or recent visible agent context; do not invent source text.
2. Decide whether the plan needs a top visual surface with the rules below, then call
   \`create-visual-plan\` with the title, brief, source, repo path, and structured
   \`content\` blocks. When a source plan already exists, pass it as \`planText\`
   and preserve the original plan's intent while adding structured review
   content.
3. Compose or enrich any top UI/product visual surface from the kit and write the
   document with native blocks (see the cores below). Keep the document close to
   the Markdown plan the agent would normally output, or to the existing plan
   when one was provided. For architecture, backend, refactor, API, data-model,
   migration, or code plans, usually omit \`content.canvas\` and
   \`content.prototype\`; put \`diagram\`, \`mermaid\`, \`api-endpoint\`,
   \`openapi-spec\`, \`data-model\`, \`diff\`, \`file-tree\`, \`json-explorer\`,
   \`code\` and \`annotated-code\` blocks directly next
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
5. Call \`get-plan-feedback\` before editing, after review, after any long pause,
   and before the final response. Treat \`anchorDetails\`, resolver intent, recent
   review events, and any focused screenshots from browser handoff as the source
   of truth for exactly what changed and exactly what each comment points at.
6. Apply changes with \`update-visual-plan\`, preferring targeted \`contentPatches\`.
   When the user wants source-control friendly edits, use
   \`patch-visual-plan-source\` against the MDX files instead of regenerating the
   plan.
7. Export with \`export-visual-plan\` only when the user wants a shareable receipt
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
- **Fix vs. ask.** Apply clear-cut fixes yourself with \`update-visual-plan\`
  \`contentPatches\` — vague non-goals, unanchored claims, an obvious missing
  decision. Route genuine judgment calls back to the user instead: add them to the
  bottom \`question-form\` Open Questions block or batch them into the normal
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
  Put those wireframes in \`content.canvas\` and omit \`content.prototype\`.
- **Canvas + prototype** for multi-step UI flows, onboarding, wizards,
  review/approval flows, navigation changes, or anything where the reviewer
  needs to operate the behavior. Keep the static wireframes in
  \`content.canvas\`, add the aligned functional prototype in
  \`content.prototype\`, and rely on the top visual tabs to switch between them.
- **Prototype-first** when the user explicitly asks for \`/prototype-plan\`, asks
  to operate the UI, or when interaction is the main question. Use
  \`create-prototype-plan\`, which still preserves static mocks where useful.

For mixed canvas + prototype plans, reuse the same real labels, app statuses,
and screen ids across both surfaces. The canvas is the inspectable static reference;
the prototype is the interactive version of that same flow, not a separate
design direction.

## Wireframe & Canvas Core

This section is shared by \`/visual-plan\` and \`/ui-plan\`, and is the single
source of truth for how wireframes and the canvas work. The wireframe-quality
rules below are additionally shared, word for word, with \`/visual-recap\`; the
canvas/artboard mechanics apply only to \`/visual-plan\` and \`/ui-plan\`. Do not
paraphrase any of it per command.

${WIREFRAME_QUALITY_CORE}

${CANVAS_SURFACE_CORE}

## Document Quality Core

This section is shared, word for word, by \`/visual-plan\` and \`/ui-plan\`. It is
the single source of truth for the document below the canvas. Do not paraphrase
it per command.

${DOCUMENT_QUALITY_CORE}

## Good vs. Bad Exemplar

${EXEMPLAR_CORE}

## Tool Guidance

- \`create-visual-plan\`: start one structured visual plan per agent task/run, or
  import an existing text plan by passing \`planText\`; \`content\` may include no
  visual surface, canvas only, or canvas + prototype.
- \`create-ui-plan\`: start a UI-first plan when the work is primarily product UI.
- \`create-prototype-plan\`: start a prototype-first plan with a functional top
  review surface.
- \`create-plan-design\`: start a full-fidelity branded Design-tab plan with an
  optional matching Prototype tab.
- \`convert-visual-plan-to-prototype\`: convert an existing HTML wireframe canvas
  into a prototype plan.
- \`create-visual-questions\`: use only for the explicit \`/visual-questions\`
  command, not as \`/visual-plan\` preflight.
- \`update-visual-plan\`: revise content, status, or comments; prefer
  \`contentPatches\` over regenerating the whole plan.
- \`read-visual-plan-source\`: read the normalized plan as \`plan.mdx\`,
  optional \`canvas.mdx\`, optional \`.plan-state.json\`, and JSON.
- \`patch-visual-plan-source\`: apply granular MDX AST patches by stable block,
  artboard, annotation, component, or wireframe-node id.
- \`import-visual-plan-source\`: create or replace a plan from an MDX folder.
- \`get-visual-plan\`: read the current structured plan, exported HTML, and
  annotations; it also returns the MDX folder for source workflows.
- \`get-plan-feedback\`: read unconsumed human feedback. Use it frequently; it
  returns grouped threads, exact anchor details, expected resolver, and recent
  review-event payloads so agents can act only on the comments meant for them.
- \`export-visual-plan\`: export HTML, Markdown fallback, structured JSON, and MDX
  files for repo check-in.

When the user critiques a plan's look or structure, fix the renderer or this
skill — never hand-edit one stored plan. Turn feedback into better guidance.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and
authenticates it in the same step (a one-time browser sign-in at setup — this is
intended), so the first tool call does not hit an OAuth wall:

\`\`\`bash
agent-native skills add visual-plan
\`\`\`

After that, \`/visual-plan\` (and \`/visual-recap\`, \`/ui-plan\`,
\`/prototype-plan\`, \`/plan-design\`, \`/visual-questions\`) generate a plan and open
the editor. Pass \`--no-connect\` to
register the connector without authenticating, then run
\`agent-native connect https://plan.agent-native.com\` whenever you are ready.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns \`needs auth\`, \`Unauthorized\`, or \`Session terminated\`,
do not keep retrying the tool. Authenticate the connector with
\`agent-native connect https://plan.agent-native.com\` (OAuth-capable hosts can
instead re-run /mcp and choose Authenticate), then continue once the connector
is available.

Hosted default: connect \`https://plan.agent-native.com/_agent-native/mcp\`. Do
not put shared secrets in skill files.
`;

export const UI_PLAN_SKILL_MD = `---
name: ui-plan
description: >-
  Use Agent-Native Plans for UI-first planning with an optional top pan/zoom
  wireframe canvas, a refined Notion-like document, rich tabs, diagrams,
  comments, drawing, and agent handoff.
metadata:
  visibility: exported
---

# UI Plan

Use \`/ui-plan\` when the task is primarily about product UI, user flows,
interaction details, component layout, or visual direction. The reviewable UI
comes first; implementation detail comes after the user has something concrete to
react to.

\`/visual-plan\` remains the general command for architecture, backend, refactors,
and mixed work. Use \`/prototype-plan\` when the UI review needs a functional live
prototype instead of static screens. Use \`/plan-design\` when polish, brand, or
visual fidelity are material to the decision. Use \`/visual-questions\` only when
the user explicitly wants visual intake before planning. Use \`/visual-plan\` when
a text plan already exists and should become the source material for the review.

## Plan Discipline

- **Gate hard.** Use a UI plan when the surface is new, ambiguous, spans several
  screens or states, or the direction needs agreement before coding. Skip it for
  cosmetic one-liners — a color, a label, a spacing tweak — and just make the
  change. Never ship a single-step or filler plan.
- **Research before you draft.** Read the real components, routes, and design
  tokens first; ground every mockup and the file map in actual files and symbols.
  Delegate wide exploration to a sub-agent when the surface is large.
- **Planning is read-only.** Make no source edits while building or reviewing.
  Start editing only after the user approves the UI direction.
- **Clarify vs. assume.** Do not ask how to build the UI — present the direction
  and options as mockups and tabs. Ask a clarifying question only when an
  ambiguity would change the design; use the host agent's normal
  ask-user-question flow and batch 2-4 before finalizing. Do not call
  \`create-visual-questions\` from \`/ui-plan\`; keep answerable follow-up inside
  the same plan as a bottom \`question-form\` Open Questions block. Otherwise
  state the assumption in the plan and proceed.
- **The plan is the approval gate.** Ask the user to review and approve the UI
  direction before you write code, and name the files/areas the work touches.

## UI-First Workflow

1. Follow the host agent's normal planning flow: inspect the codebase, gather
   the UI/component context needed, and ask native clarifying questions as needed
   before generating the plan.
2. Call \`create-ui-plan\` with a UI-specific title, brief, source, repo path, and
   structured \`content\`. The canvas comes first, the document second.
3. Compose the top canvas from the kit (see the cores below): the key artboards
   with real product content, designer notes, and connectors only for real
   sequences. Skip the canvas when wireframes would not clarify the work.
4. Continue below as a concise technical document that stays close to the
   Markdown plan the agent would normally output — not a second copy of the
   canvas — covering concrete files, contracts, phases, risks, and validation.
5. Call \`get-plan-feedback\` before implementation, after review, after a long
   pause, and before the final response. Treat \`anchorDetails\`, resolver intent,
   recent review events, and any focused screenshots from browser handoff as the
   source of truth for exactly what changed and exactly what each UI comment
   points at. Apply changes with \`update-visual-plan\`, preferring
   \`contentPatches\` for one frame, annotation, node, tab, or block. When the
   user wants source-control friendly edits, use \`patch-visual-plan-source\`
   against the MDX files instead of regenerating the plan.

## Agent Handoff

After the canvas and document, add a short handoff that names the chosen UI
direction, unresolved visual questions, and feedback that must be read before
code changes. Never claim feedback has been applied until \`get-plan-feedback\` or
the user has supplied it.

## Wireframe & Canvas Core

This section is shared by \`/visual-plan\` and \`/ui-plan\`, and is the single
source of truth for how wireframes and the canvas work. The wireframe-quality
rules below are additionally shared, word for word, with \`/visual-recap\`; the
canvas/artboard mechanics apply only to \`/visual-plan\` and \`/ui-plan\`. Do not
paraphrase any of it per command.

${WIREFRAME_QUALITY_CORE}

${CANVAS_SURFACE_CORE}

## Document Quality Core

This section is shared, word for word, by \`/visual-plan\` and \`/ui-plan\`. It is
the single source of truth for the document below the canvas. Do not paraphrase
it per command.

${DOCUMENT_QUALITY_CORE}

## Good vs. Bad Exemplar

${EXEMPLAR_CORE}

## Tool Guidance

- \`create-ui-plan\`: create the UI-first structured visual plan.
- \`create-prototype-plan\`: create a prototype-first plan when UI review needs a
  functional live prototype.
- \`create-plan-design\`: create a full-fidelity branded design plan when polish,
  brand, and detailed visual direction are primary review inputs.
- \`convert-visual-plan-to-prototype\`: convert an existing HTML wireframe canvas
  into a prototype plan.
- \`create-visual-questions\`: use only for the explicit \`/visual-questions\`
  command, not as \`/ui-plan\` preflight.
- \`update-visual-plan\`: revise content, mockups, comments, or handoff notes;
  prefer targeted \`contentPatches\`.
- \`read-visual-plan-source\`: read the normalized plan as \`plan.mdx\`,
  optional \`canvas.mdx\`, optional \`.plan-state.json\`, and JSON.
- \`patch-visual-plan-source\`: apply granular MDX AST patches by stable block,
  artboard, annotation, component, or wireframe-node id.
- \`import-visual-plan-source\`: create or replace a plan from an MDX folder.
- \`get-visual-plan\`: inspect the current structured plan, exported HTML, and
  annotations; it also returns the MDX folder for source workflows.
- \`get-plan-feedback\`: read unconsumed reviewer comments before coding; it
  returns grouped threads, exact anchor details, expected resolver, and recent
  review-event payloads so agents can act only on the comments meant for them.
- \`export-visual-plan\`: export HTML, Markdown fallback, structured JSON, and MDX
  files for repo check-in.

When the user critiques a plan's look or structure, fix the renderer or this
skill — never hand-edit one stored plan. Turn feedback into better guidance.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and
authenticates it in the same step (a one-time browser sign-in at setup — this is
intended), so the first tool call does not hit an OAuth wall:

\`\`\`bash
agent-native skills add visual-plan
\`\`\`

After that, \`/visual-plan\` (and \`/visual-recap\`, \`/ui-plan\`,
\`/prototype-plan\`, \`/plan-design\`, \`/visual-questions\`) generate a plan and open
the editor. Pass \`--no-connect\` to
register the connector without authenticating, then run
\`agent-native connect https://plan.agent-native.com\` whenever you are ready.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns \`needs auth\`, \`Unauthorized\`, or \`Session terminated\`,
do not keep retrying the tool. Authenticate the connector with
\`agent-native connect https://plan.agent-native.com\` (OAuth-capable hosts can
instead re-run /mcp and choose Authenticate), then continue once the connector
is available.

Hosted default: connect \`https://plan.agent-native.com/_agent-native/mcp\`. Do
not put shared secrets in skill files.
`;

export const PROTOTYPE_PLAN_SKILL_MD = `---
name: prototype-plan
description: >-
  Use Agent-Native Plans for /prototype-plan when work needs a functional
  prototype-first plan, static mocks, comments, review toggles, or conversion
  from a visual plan.
metadata:
  visibility: exported
---

# Prototype Plan

\`/prototype-plan\` creates a plan whose primary review surface is a live,
functional prototype above the document. Use it when the user needs to feel a
flow, operate basic UI state, or comment on interaction before implementation
hardens the decision.

## Rule

Make the prototype answer a concrete question. The plan should say what is being
tested, show the functional prototype first, then keep static mocks and implementation
notes in the document below.

## When To Use

Use \`/prototype-plan\` when the user asks for a prototype, wants to click through
and operate UI states, needs design review before code, wants comments pinned to
live screens, or asks to move a visual plan into a prototype.

Prefer \`/visual-plan\` for architecture, data flow, or non-interactive planning.
Prefer \`/ui-plan\` when static screen review is enough. Use \`/visual-plan\` first
when the user hands you an existing Markdown/Codex/Claude plan that needs a
visual companion before becoming interactive.

## Core Workflow

1. Inspect the real codebase and decide the question the prototype should
   answer. Good examples: "Does this onboarding flow feel short enough?" or
   "Which dashboard density should we implement?"
2. Call \`create-prototype-plan\` with a title, brief, and screen HTML. Default to
   one functional prototype screen when local UI behavior is enough; use 2-4
   screens only for true routes, steps, or materially different contexts. The
   returned plan opens with the prototype viewer on top and static mocks, flow
   diagram, implementation map, and verification below.
3. Make controls actually work. Use the renderer's safe Alpine-like directives:
   \`x-data\`, \`x-model\`, \`x-for\`, \`x-text\`, \`x-show\`, \`:class\`, \`@click\`, and
   \`@keydown.enter\`. Use safe helper verbs such as \`remove(list, item)\`,
   \`setAll(list, 'done', true)\`, \`removeWhere(list, 'done', true)\`, and counters
   such as \`count(list)\`, \`countWhere(list, 'done', true)\`, and
   \`remaining(list, 'done')\` when they help. Use \`data-goto="screen-id"\` only
   for true screen/route changes, not for every button press.
4. Show important app feedback inside the prototype itself: selected filters,
   checked rows, typed drafts, validation messages, permissions, progress, or
   empty states.
5. Surface the returned Plans link and ask the user to click through, comment on
   the prototype or static mocks, and approve the direction before code changes.
6. Before implementing or revising, call \`get-plan-feedback\`. Treat prototype
   anchors, screenshots, and resolver intent as the source of truth.
7. Update with \`update-visual-plan\` content patches. Use
   \`patch-prototype-html\`, \`update-prototype-screen\`, or \`set-prototype\` for
   targeted prototype edits instead of regenerating the whole plan.

## Converting A Visual Plan

When a visual plan already has HTML canvas wireframes, call
\`convert-visual-plan-to-prototype\` with the plan id. This derives prototype
screens from the canvas frames, preserves the canvas/static mocks by default,
and changes the top review surface to the prototype viewer.

Use \`removeCanvas: true\` only when the user explicitly wants the old canvas
gone. Otherwise keep static mocks available for source export and detailed
review.

## Prototype Screen HTML

Write bounded semantic HTML fragments only:

\`\`\`html
<div style="display:flex;flex-direction:column;gap:14px;padding:18px;height:100%">
  <header style="display:flex;justify-content:space-between;gap:12px">
    <div>
      <h1>Launch checklist</h1>
      <p class="wf-muted">Reviewer can add, complete, filter, and remove tasks.</p>
    </div>
    <span class="wf-pill accent">Live prototype</span>
  </header>
  <section
    class="wf-card"
    x-data="{ draft: '', filter: 'all', todos: [{ text: 'Check copy', done: false }, { text: 'Confirm owner', done: true }] }"
    style="display:flex;flex-direction:column;gap:10px"
  >
    <div style="display:flex;gap:8px">
      <input x-model="draft" @keydown.enter="draft && todos.push({ text: draft, done: false }); draft = ''" placeholder="Add task" />
      <button class="primary" @click="draft && todos.push({ text: draft, done: false }); draft = ''">Add</button>
    </div>
    <div style="display:flex;gap:8px">
      <button @click="filter = 'all'" :class="{ primary: filter === 'all' }">All</button>
      <button @click="filter = 'done'" :class="{ primary: filter === 'done' }">Done</button>
      <button @click="setAll(todos, 'done', true)">Mark all done</button>
    </div>
    <p class="wf-muted"><span x-text="remaining(todos, 'done')"></span> open / <span x-text="count(todos)"></span> total</p>
    <div
      class="wf-box"
      x-for="todo in todos"
      x-show="filter === 'all' || (filter === 'done' && todo.done)"
      :class="{ 'is-done': todo.done }"
      style="display:flex;justify-content:space-between;gap:10px"
    >
      <label style="display:flex;gap:8px"><input type="checkbox" x-model="todo.done" /><span x-text="todo.text"></span></label>
      <button @click="remove(todos, todo)">Remove</button>
    </div>
    <button @click="removeWhere(todos, 'done', true)">Clear completed</button>
  </section>
</div>
\`\`\`

Use real labels, counts, dates, and controls grounded in the target app. Keep
surfaces honest: \`browser\` for web pages, \`desktop\` for app shells, \`mobile\`
only for real mobile work, \`panel\` for side panels, and \`popover\` for menus.

Do not include \`<html>\`, \`<body>\`, \`<script>\`, \`<style>\`, browser \`on*\`
handler attributes such as \`onclick\`, fake APIs, raw secrets, or customer data.
The renderer owns sketchy/clean mode, theme, surface sizing, rough outlines, and
comment overlays.

## Review Surface

Prototype plans support:

- real local controls through safe prototype directives
- optional screen/route transitions from \`data-goto\`
- rough vs clean mode through the shared wireframe toggle
- dark vs light mode through the shared theme toggle
- comment visibility from the prototype toolbar
- Figma-style comments pinned directly on live prototype screens
- a popout URL with \`?prototype=1\` for focused browser review
- static wireframe mocks in the document body where they help implementation

## Source Files

Runtime JSON is canonical. Source export uses:

- \`plan.mdx\` for document blocks
- \`prototype.mdx\` for \`<Prototype>\`, \`<PrototypeScreen>\`, and
  \`<PrototypeTransition>\`
- \`canvas.mdx\` for static mocks when a canvas is present
- \`.plan-state.json\` for persisted viewport state

Patch source with \`patch-visual-plan-source\` only when the user wants
source-control friendly edits. Patch runtime content when the user is simply
reviewing and iterating.

## Related Skills

- \`visual-plan\`
- \`ui-plan\`
- \`visual-questions\`
`;

export const PLAN_DESIGN_SKILL_MD = `---
name: plan-design
description: >-
  Use Agent-Native Plans for full-fidelity UI design planning with a Design
  canvas tab and optional interactive Prototype tab before implementation.
metadata:
  visibility: exported
---

# Plan Design

Use \`/plan-design\` when the user needs a high-fidelity product design before
implementation: polished branded screens, realistic content, visual direction,
and interaction review. It is the full-fidelity companion to \`/visual-plan\` and
\`/prototype-plan\`: the top review surface should show \`Design\` and, when the
flow needs interaction, \`Prototype\`.

## When To Use

Use this for UI-heavy work where brand, visual hierarchy, polished layout, or
interaction feel are material to the decision. Skip it for small copy, spacing,
or obvious component changes.

## Research First

Before creating the plan:

1. Inspect the real app shell, routes, components, CSS variables, Tailwind
   tokens, theme files, and any relevant screenshots.
2. If \`design.md\` exists, treat it as the primary design brief and pass its
   important content into \`create-plan-design.designMd\`.
3. If a \`.fig\` local-copy file or parsed brand kit is available, use the
   Design/brand-kit parsing actions from the app or shared tooling first, then
   pass the extracted token summary into \`brandKit\`.
4. Parse existing codebase style info when possible: CSS custom properties,
   Tailwind config, global CSS, font declarations, spacing/radius tokens, and
   component conventions. Pass the compact evidence into \`codebaseStyles\`.
5. Ground every screen in actual product content. Avoid lorem ipsum, generic
   marketing filler, and placeholder gray boxes unless designing an explicit
   loading state.

## Create The Plan

Call \`create-plan-design\` with:

- \`title\`, \`brief\`, \`repoPath\`, and any \`implementationNotes\`.
- \`designMd\`, \`brandKit\`, \`codebaseStyles\`, or \`designNotes\` when available.
- \`screens\`: one to six full-fidelity HTML/CSS screen fragments. Each screen
  must include a bounded \`html\` fragment, optional scoped \`css\`, a \`surface\`,
  and stable \`data-design-id\` attributes on elements a reviewer might edit.
- \`transitions\` only when the Prototype tab should support true screen/step
  navigation. Use \`data-goto="screen-id"\` in the screen HTML for those controls.

The Design tab is the visual source of truth. The Prototype tab is for behavior
and should reuse the same visual styling where practical. Do not create a
separate design direction in the prototype.

## Full-Fidelity HTML Rules

- Write bounded fragments only: no \`<html>\`, \`<head>\`, \`<body>\`, \`<script>\`,
  \`<style>\`, external imports, iframes, SVG, or executable URLs.
- Put CSS in the screen \`css\` field. The renderer scopes it to the artboard.
- Use real CSS and CSS variables. Tailwind-like class names are fine only when
  the provided \`css\` defines them or the classes are harmless semantic hooks.
- Use \`renderMode: "design"\` on design screen data when authoring full
  structured content directly.
- Add \`data-design-id="meaningful-name"\` to editable elements such as hero
  panels, key buttons, cards, nav items, pricing rows, chart panels, and state
  chips. Keep ids stable and descriptive.
- Keep the design responsive within the selected surface. Text must not clip,
  overlap, or rely on viewport-sized type.

## Targeted Style Edits

When a reviewer selects an element in the Design tab or asks for a specific
style change, avoid regenerating the whole plan. Use:

\`\`\`json
{
  "op": "update-design-element-style",
  "frameId": "frame-overview",
  "elementId": "primary-cta",
  "styles": {
    "background-color": "#0f766e",
    "border-radius": "10px"
  }
}
\`\`\`

Use \`frameId\` for inline canvas designs or \`blockId\` for a referenced wireframe
block. Set a style value to \`null\` to remove it. Use \`patch-wireframe-html\` or
\`patch-prototype-html\` for text/content changes inside a fragment.

## Document Handoff

Below the visual surface, keep the document concise and implementation-oriented:
actual files and symbols, state/actions/contracts, open questions, risks, and
verification. The document should not repeat the same screens in prose.

Before implementation, call \`get-plan-feedback\` and treat comments, selected
element details, and recent review events as the source of truth.

## Related Skills

- \`visual-plan\`
- \`ui-plan\`
- \`prototype-plan\`
- \`frontend-design\`
`;

export const VISUAL_RECAP_SKILL_MD = `---
name: visual-recap
description: >-
  Use Agent-Native Plans to turn a code change, PR diff, or git diff into a
  visual recap plan for high-altitude review — schema, API, file, and
  before/after changes as grounded structured blocks instead of a wall of diff.
metadata:
  visibility: exported
---

# Visual Recap

\`/visual-recap\` creates a visual plan built **from** a diff, not toward one. It
is the reverse of forward planning: instead of describing the change you are
about to make, you describe the change that was just made, at a higher altitude
than line-by-line review. The same plan data model serves both directions —
schema, API, file, and architecture changes become the same \`data-model\`,
\`api-endpoint\`, \`file-tree\`, and \`diagram\` blocks a forward plan would use, only
now they summarize work that exists. A reviewer scans the shape of the change
before spending attention on the literal lines.

## Always Publish As An Agent-Native Plan — Never Inline

The deliverable is ALWAYS a published Agent-Native Plan, created with the
\`create-visual-recap\` tool on the \`plan\` MCP server. NEVER hand the recap to the
user as inline chat content — not Markdown prose, not an ASCII sketch, not a
table, not a fenced "wireframe", not a "here's the recap" summary. A recap's
entire value is the hosted, interactive, annotatable plan; an inline summary is
not a recap, it is the thing a recap replaces. The only supported output is to
publish the plan and return its absolute URL.

If the \`plan\` MCP server's tools are not available, do NOT improvise an inline
recap as a fallback. The usual cause is a connector that did not finish
connecting this session (it registers zero tools), NOT necessarily an auth
problem — so do not assume the user must authenticate. Stop and tell the user
how to restore it: reconnect the plan MCP server (in Claude Code, run \`/mcp\` and
reconnect, or restart the session); only if it is genuinely unauthenticated, run
\`agent-native connect <plan-app-url>\` or re-authenticate via \`/mcp\`. Then publish
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

When \`/visual-recap\` is invoked in a chat thread after work has already happened,
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
the generated plan body. In particular, do not create a \`rich-text\` block just to
say the recap is an aid, that the reviewer should still review the diff, how many
files changed, or which ref/working tree generated the recap. The plan title,
brief, \`file-tree\`, and optional \`diffstat\` already carry that context.

Only add prose blocks when they tell the reviewer something specific about the
change that the structured blocks do not: the objective, a real compatibility
risk, an important decision visible in the diff, or a grounded review note.

## Recaps Must Be Substantial

Lean is not the same as thin. A recap is not a single wireframe plus one
sentence — that under-serves the reviewer as much as boilerplate prose over-serves
them. Alongside the visual/structural headline (wireframes, \`data-model\`,
\`api-endpoint\`, \`diagram\`), a substantial recap also carries the implementation
evidence:

- A \`file-tree\` of the changed files with each entry's \`change\` flag, so the
  reviewer sees the footprint of the work at a glance.
- The split \`diff\` of the KEY changed files, grouped under a \`## Key changes\`
  \`rich-text\` heading in a single vertical \`tabs\` block (file labels as the left
  rail), with a one-line \`summary\` and a few \`annotations\` on each — so the
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

- Use a \`Before\` / \`After\` wireframe pair when the reviewer benefits from direct
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
  matching \`surface\` (\`popover\`, \`panel\`, etc.) and show the focused sub-surface.
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
\`/visual-plan\` and \`/ui-plan\`: it is the single source of truth for HTML
wireframe quality, and applies to a recap's standalone \`wireframe\` /
\`WireframeBlock\` / \`<Screen>\` exactly as it applies to a plan's canvas artboard.

${WIREFRAME_QUALITY_CORE}

Use the standard \`WireframeBlock\` / \`<Screen>\` format so the Plan viewer owns the
surface frame, theme, and sketchy/clean toggle. HTML wireframes are appropriate
when placement precision matters, especially popovers, menus, dialogs, and dense
forms; kit-tree wireframes are appropriate for simpler layouts. For HTML
wireframes, keep \`renderMode\` unset or \`wireframe\` unless a design-only editable
mockup is explicitly required, because \`renderMode="design"\` disables the
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
link; report THAT. Never make the primary link a local \`plan.mdx\` file, a local
mirror folder, or a relative path such as \`/plans/<id>\`.

A recap lives only in the database of the MCP that created it. A separately
running local dev server (e.g. \`http://localhost:8081\`) has its OWN database and
will NOT contain a recap created through the hosted MCP, so a hand-built
\`localhost\` link returns "Plan not found". This is the most common recap
mistake — do not guess an origin you have not confirmed shares the MCP's data.

Resolve the URL in this order:

1. Use the absolute URL the create tool RETURNS — \`openLink.webUrl\`, else the
   \`visualUrl\` in the returned \`plan.mdx\` frontmatter, else \`url\`/\`path\`
   resolved against the MCP server's own origin (for the hosted MCP that is
   \`https://plan.agent-native.com\`). This always points at the database that has
   the plan.
2. Use a \`localhost\`/dev origin ONLY when the recap was created through a Plan
   MCP bound to that same origin — i.e. that MCP's url is
   \`http://localhost:<port>/_agent-native/mcp\`. Creating through the hosted MCP
   and linking to localhost is the exact mismatch that 404s.
3. If only a plan id is available, build the MCP origin's absolute URL
   (hosted: \`https://plan.agent-native.com/plans/<id>\`) and say it was inferred.

If the user wants to review on localhost but the recap was created through the
hosted MCP, say so plainly: the local dev server cannot see it. To view a recap
on localhost (e.g. to exercise un-deployed local renderer changes), they must
connect a LOCAL Plan MCP (\`http://localhost:<port>/_agent-native/mcp\`) and
re-create the recap through it so it lands in the local database; offer to do
that rather than handing over a localhost URL that will not resolve.

When running in Codex and the Browser/in-app side browser tools are available,
open the returned absolute recap URL there automatically after creation. Still
include the same absolute URL in the final response. Local mirror files like
\`plans/<slug>/plan.mdx\` may be mentioned only as secondary source-control
artifacts, not as the main way to open the recap.

## Diff → Block Mapping

Map each kind of change to the block that carries it, derived mechanically from
the actual diff:

- **Schema / migration change** → \`data-model\` for the resulting entities,
  fields, and relations. Flag what moved per field/entity with
  \`change: "added" | "modified" | "removed" | "renamed"\`, and for a changed type
  set \`was\` to the prior value (e.g. the old column type) — grounded in the real
  migration diff. That diff-aware \`data-model\` is the headline; reach for a split
  \`diff\` of the literal SQL only when the exact statement still matters, not by
  default.
- **API / action / route change** → \`api-endpoint\` with the method, path,
  params, request, and responses as they are after the change. Flag each changed
  param/response with \`change\` (and \`was\` on a param whose type/shape changed),
  and set \`change\` on the endpoint root for a wholly added or removed route. Mark
  removed endpoints with \`deprecated: true\` and explain in prose.
  Keep multiple API endpoints in the normal single-column document flow unless
  they are an explicit before/after contract comparison.
  Author each request/response example as a SINGLE valid JSON value — one
  top-level object or array, parseable on its own — so it renders in the
  collapsible JSON explorer. Do not put \`//\` or \`/* */\` comments, prose,
  trailing commas, or two or more concatenated top-level objects inside one
  example; a non-parseable body falls back to flat text and loses the explorer.
  When an endpoint has several distinct message shapes (for example separate
  websocket frame types, or a success body versus an error body), give each its
  OWN example with its own label rather than cramming them into one body.
- **Compatibility-sensitive change** → short \`rich-text\` notes beside the
  relevant \`data-model\` / \`api-endpoint\` block. Name the changed field,
  endpoint, or behavior and mark whether it is breaking, risky, or non-breaking;
  pair that note with a split \`diff\` for the literal lines.
- **Any meaningful code hunk** → \`diff\` with \`mode: "split"\`, carrying the real
  \`before\` / \`after\` text and the \`filename\` / \`language\`. Split mode is the
  default for a recap because before/after legibility is the whole point. Give
  every \`diff\` a one-line \`summary\` saying what the hunk changes and why; it
  renders as a description above the code so the reviewer reads intent first.
  Never leave a diff unlabeled.
  For the KEY changed files, attach \`annotations\` to the \`diff\` so the recap
  calls out what each important hunk does — this is the headline affordance for
  annotating the key files updated. Each annotation is
  \`{ side?: "before" | "after"; lines: "13" | "13-15"; label?: string; note }\`
  and anchors to the AFTER-side line numbers by default (set \`side: "before"\` to
  point at removed lines). Keep it to a few high-signal notes per file, not one
  per line.
  When several key files each need a substantial diff, introduce the group with a
  \`rich-text\` heading block whose markdown is \`## Key changes\`, then place the
  \`diff\` blocks under it in a reusable \`tabs\` block with
  \`orientation: "vertical"\` so file labels form a left rail and the selected
  file's split diff renders on the right. Let that heading label the section — do
  NOT also set a \`title\` on the \`tabs\` block. Keep each tab label to the file
  path or a short basename plus directory hint.
  If the recap ends with more than one supporting diff, that trailing diff
  appendix should be one vertical \`tabs\` block under its own \`## Key changes\`
  heading, not a stack of separate \`diff\` blocks.
- **Brand-new file or a substantial added block with no meaningful "before"** →
  \`annotated-code\` rather than a one-sided split \`diff\`. Carry the real new code
  with its \`filename\` / \`language\` and anchor a few high-signal notes to the lines
  that matter (\`{ lines: "12" | "12-18"; label?; note }\`) so the reviewer reads
  what the new code does, not code for code's sake. Keep split \`diff\` for true
  before/after hunks where the removed lines still carry meaning, and group
  several annotated walkthroughs in a vertical \`tabs\` block the same way diffs are
  grouped.
- **Files added / removed / renamed** → \`file-tree\` with each entry's \`change\`
  flag (\`added\`, \`removed\`, \`modified\`, \`renamed\`) and a short \`note\`; attach a
  \`snippet\` only when one tells the reviewer something the path does not.
- **Rendered UI / interaction change** → one or more wireframes showing the
  visible UI delta before the reviewer reads code. Use \`Before\` / \`After\`
  wireframes when the comparison clarifies the change; otherwise use after-only
  or a short state/flow sequence. Use realistic UI surfaces: for a popover
  change, show a popover with its title row, top-right actions, options/fields,
  and any opened prompt/menu anchored to the correct trigger. Keep the body lean:
  the wireframe carries the UI story, while the file tree and split \`diff\`
  blocks carry implementation evidence.
- **Architecture or data-flow shift** → \`diagram\` with \`data.html\` / \`data.css\`
  as a two-panel before/after, layered, or swimlane layout, or \`mermaid\` for a
  quick graph. Use the two-dimensional layouts the Document Quality core
  prescribes; do not reduce a structural change to a left-to-right chain.
  Do not use \`diagram\` as a stand-in for rendered UI controls; UI changes need
  \`wireframe\` blocks.
  Diagram HTML/CSS should use renderer-owned primitives such as
  \`.diagram-panel\`, \`.diagram-card\`, \`.diagram-node\`, \`.diagram-box\`,
  \`.diagram-pill\`, \`.diagram-muted\`, and \`[data-rough]\`; these map to the plan's
  Tailwind theme variables through \`--wf-ink\`, \`--wf-muted\`, \`--wf-line\`,
  \`--wf-paper\`, \`--wf-card\`, \`--wf-accent\`, \`--wf-accent-soft\`, \`--wf-warn\`, and
  \`--wf-ok\`, and switch to Excalifont plus rough.js outlines in sketchy mode. Do not
  set \`font-family\` and do not emit hex, rgb/hsl literals, or one-off dark/light
  palettes in diagram CSS.
- **Outcome-first narrative** → \`rich-text\` for the "what changed and why" prose:
  the objective the diff served, the key decisions visible in it, and the risks a
  reviewer should weigh. This is the only place the model writes freely.

## Before / After Is The Headline

The recap's center of gravity is the before/after comparison. For document-body
comparisons there are two primitives, and they cover the whole need together:

- **\`columns\`** — the side-by-side container, for **structured** comparisons.
  Use two columns labeled \`Before\` and \`After\`, each holding a block (commonly a
  \`data-model\`, \`api-endpoint\`, or \`rich-text\`), so the reviewer reads the old
  shape against the new shape in one glance. This is the right primitive for
  "the schema went from X to Y" or "the endpoint contract changed like this."
  Do not use \`columns\` simply to compact or group a list of API endpoints.
- **\`diff\` with \`mode: "split"\`** — for **code**. The split renders the literal
  removed and added lines side by side. Use it for the actual hunks.

For UI diffs, wireframes are the visual comparison primitive. Use before/after
wireframes when the comparison clarifies the change; use after-only or a state
sequence when that better matches the change. The visual headline must show
exact placement, realistic chrome, and adequate padding before any abstract
explanation. The Wireframe Quality core owns the before/after layout choice —
the \`columns\` renderer keeps narrow surfaces side by side and auto-stacks wide
\`desktop\`/\`browser\` frames vertically; never hand-build a side-by-side
wireframe layout in \`custom-html\`. For document-body
comparisons, there is no other multi-column primitive — \`columns\` plus split
\`diff\` are the whole comparison vocabulary. Do not hand-build side-by-side
layouts in \`custom-html\`, and do not stack two \`data-model\` blocks vertically
and call it a comparison when \`columns\` exists to put them side by side.

## Grounding Rule

Structured blocks are **true by construction** only if they are derived from the
actual changed lines. The \`diff\`, \`data-model\`, \`api-endpoint\`, and \`file-tree\`
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
  URLs, signing secrets, \`.env\` values, or credential-looking literals. Do not
  copy any of these into a \`diff\`, \`file-tree\` snippet, \`api-endpoint\`, or prose
  block — redact them (\`sk-•••\`, \`<redacted>\`). This mirrors the repo's
  hardcoded-secret rule: obviously fake placeholders only, never the real value,
  in any block, caption, or note.

## Bidirectional Loop (Fast-Follow)

Because a recap is a real, editable plan, the same review loop as forward plans
applies: a reviewer can annotate any block, and the coding agent reads
\`get-plan-feedback\` to drive fixes back into the code — annotation → agent →
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
`;

export const VISUAL_QUESTIONS_SKILL_MD = `---
name: visual-questions
description: >-
  Use Agent-Native Plans to ask rich visual intake questions when
  /visual-questions is explicitly requested before creating a UI plan or visual
  plan.
metadata:
  visibility: both
---

# Visual Questions

Use \`/visual-questions\` when the next best step is not a plan yet, but a
reviewable visual intake: single-choice option rows, multi-select option rows,
freeform notes, mockup choices, sketch diagrams, and a generated answer summary
that feeds the next planning prompt. It composes with \`/visual-plan\`, \`/ui-plan\`,
\`/prototype-plan\`, and \`/plan-design\`.

## When To Use

- The user asks to be shown options before the agent writes a plan.
- UI direction, form factor, layout model, feature set, or visual style is fuzzy
  enough that 2-6 answers would materially change the plan.
- The user would benefit from choosing between visual mockups or diagrams rather
  than answering text-only prompts.

Gate hard: skip this for tiny, unambiguous changes. If the agent can reasonably
infer the answer, prefer \`/ui-plan\`, \`/prototype-plan\`, \`/plan-design\`, or
\`/visual-plan\` directly and put assumptions in the plan.

Visual questions are an explicit intake command, not an automatic preflight for
\`/visual-plan\`, \`/ui-plan\`, \`/prototype-plan\`, or \`/plan-design\`.

## Workflow

1. Call \`create-visual-questions\` with a clear title, brief, source, and repo
   path when known.
2. Omit \`questions\` for the default UI intake. Provide a custom \`questions\` array
   only when the task has domain-specific choices.
3. Surface the returned Plans link and ask the user to answer visually.
4. The generated summary drives the next step: \`create-ui-plan\` for static UI
   review, \`create-prototype-plan\` for click-through UI flows,
   \`create-plan-design\` for high-fidelity branded UI review,
   \`create-visual-plan\` for general plans or when a text plan already exists,
   or \`update-visual-plan\` with targeted \`contentPatches\` to fold answers into
   an active plan.
5. If the user leaves comments, call \`get-plan-feedback\` before using the answers.

## Question Types

Supported \`questions\` entries:

- \`single\`: chip group where one option wins.
- \`multi\`: chip group where multiple options can be selected.
- \`freeform\`: textarea for constraints, inspirations, or things to avoid.
- \`visual\`: visual options with sketch previews — use for layout direction, flow
  depth, surface choice, or diagram choices.

Each option can include \`label\`, \`value\`, \`description\`, \`recommended\`,
\`preview\`, and \`bullets\`. Valid \`preview\` values match the wireframe surfaces:
\`desktop\`, \`mobile\`, \`popover\`, \`panel\`, \`component\`, \`split\`, \`flow\`, and
\`diagram\`. Pick the preview that matches the real footprint — do not offer a
desktop/mobile pair for a popover, panel, or component.

\`single\`, \`multi\`, and \`visual\` questions always render a write-in field, so a
reviewer can answer with their own option instead of the listed choices. Do not
add an explicit "Other" or "Something else" option yourself; set
\`allowOther: false\` only on the rare question where a free-text answer makes no
sense.

## Quality Bar

- Ask only decision-changing questions. A beautiful form with low-value questions
  is still friction.
- Prefer visible, answerable options over abstract prose.
- Use visual tabs when users need to compare layout or flow shapes.
- Keep the output calm and document-like, not a landing page.
- The generated answer summary is not the final plan; it is the intake prompt for
  the next agent step.

## Tool Guidance

- \`create-visual-questions\`: create the interactive intake plan.
- \`get-visual-plan\`: inspect the current visual question plan.
- \`get-plan-feedback\`: read comments before creating or updating the next plan.
- \`create-ui-plan\`: create a UI-first plan from the answers.
- \`create-prototype-plan\`: create a prototype-first plan from the answers when
  interaction feel matters.
- \`create-plan-design\`: create a high-fidelity branded design plan from the
  answers when visual polish is the primary review input.
- \`create-visual-plan\`: create a general visual plan from the answers, or pass
  existing plan text as \`planText\` when the answers should shape an imported
  plan.
- \`export-visual-plan\`: export answer plans as HTML, Markdown fallback,
  structured JSON, and MDX files when the intake needs to be checked into a repo.
- \`read-visual-plan-source\` / \`patch-visual-plan-source\`: inspect or patch the
  MDX source if another agent is operating from checked-in plan files.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and
authenticates it in the same step (a one-time browser sign-in at setup — this is
intended), so the first tool call does not hit an OAuth wall:

\`\`\`bash
agent-native skills add visual-plan
\`\`\`

After that, \`/visual-plan\` (and \`/visual-recap\`, \`/ui-plan\`,
\`/prototype-plan\`, \`/plan-design\`, \`/visual-questions\`) generate a plan and open
the editor. Pass \`--no-connect\` to
register the connector without authenticating, then run
\`agent-native connect https://plan.agent-native.com\` whenever you are ready.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns \`needs auth\`, \`Unauthorized\`, or \`Session terminated\`,
do not keep retrying the tool. Authenticate the connector with
\`agent-native connect https://plan.agent-native.com\` (OAuth-capable hosts can
instead re-run /mcp and choose Authenticate), then continue once the connector
is available.

Hosted default: connect \`https://plan.agent-native.com/_agent-native/mcp\`. Do
not put shared secrets in skill files.
`;

export const BUILT_IN_APP_SKILLS = {
  assets: {
    skillName: "assets",
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "assets",
      displayName: "Assets",
      description:
        "Create, search, select, and export brand image and video assets from the Assets app.",
      hosted: {
        url: "https://assets.agent-native.com",
        mcpUrl: "https://assets.agent-native.com/_agent-native/mcp",
      },
      mcp: { serverName: "agent-native-assets" },
      auth: {
        mode: "oauth",
        setup:
          "Authenticate with the Assets MCP connector in the host app. No shared secrets are stored in skill files.",
      },
      surfaces: [
        {
          id: "asset-picker",
          action: "open-asset-picker",
          path: "/picker",
          mediaTypes: ["image", "video"],
          defaultMediaType: "image",
        },
      ],
      skills: [
        {
          path: "skills/assets",
          visibility: "exported",
          exportAs: "assets",
        },
      ],
      hostAdapters: [
        "codex-plugin",
        "claude-marketplace",
        "vercel-skills",
        "plain-skill",
        "claude-skill",
        "chatgpt-mcp",
        "generic-mcp",
      ],
    }),
    skillMarkdown: ASSETS_SKILL_MD,
  },
  design: {
    skillName: "design-exploration",
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "design",
      displayName: "Design",
      description:
        "Explore, compare, iterate, and export interactive UI design prototypes from the Design app.",
      hosted: {
        url: "https://design.agent-native.com",
        mcpUrl: "https://design.agent-native.com/_agent-native/mcp",
      },
      mcp: { serverName: "agent-native-design" },
      auth: {
        mode: "oauth",
        setup:
          "Authenticate with the Design MCP connector in the host app. No shared secrets are stored in skill files.",
      },
      surfaces: [
        {
          id: "design-exploration",
          action: "present-design-variants",
          path: "/design",
        },
      ],
      skills: [
        {
          path: "skills/design-exploration",
          visibility: "exported",
          exportAs: "design-exploration",
        },
      ],
      hostAdapters: [
        "codex-plugin",
        "claude-marketplace",
        "vercel-skills",
        "plain-skill",
        "claude-skill",
        "chatgpt-mcp",
        "generic-mcp",
      ],
    }),
    skillMarkdown: DESIGN_EXPLORATION_SKILL_MD,
  },
  "visual-plans": {
    skillName: "visual-plan",
    extraSkills: {
      "visual-recap": VISUAL_RECAP_SKILL_MD,
    },
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "visual-plans",
      displayName: "Agent-Native Plan",
      description:
        "Generate and review coding-agent plans as structured documents with inline diagrams, implementation maps, annotations, feedback, and HTML export.",
      hosted: {
        url: "https://plan.agent-native.com",
        mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      },
      mcp: { serverName: "agent-native-plans" },
      auth: {
        mode: "oauth",
        setup:
          "Install with the Agent-Native CLI to add the /visual-plan and /visual-recap skills plus the Plan MCP connector. Authenticate only for hosted/account-backed sharing.",
      },
      surfaces: [
        {
          id: "visual-plan",
          action: "create-visual-plan",
          path: "/plans",
          description:
            "Create a general coding-agent plan. Architecture/code plans default to inline document blocks; top canvas/prototype surfaces are optional for UI/product review.",
        },
        {
          id: "visual-recap",
          action: "create-visual-recap",
          path: "/plans",
          description:
            "Create a visual recap plan from a PR, commit, branch, or git diff for high-altitude review.",
        },
      ],
      skills: [
        {
          path: "skills/visual-plan",
          visibility: "exported",
          exportAs: "visual-plan",
        },
        {
          path: "skills/visual-recap",
          visibility: "exported",
          exportAs: "visual-recap",
        },
      ],
      hostAdapters: [
        "codex-plugin",
        "claude-marketplace",
        "vercel-skills",
        "plain-skill",
        "claude-skill",
        "chatgpt-mcp",
        "generic-mcp",
      ],
    }),
    skillMarkdown: VISUAL_PLANS_SKILL_MD,
  },
  "context-xray": {
    skillName: "context-xray",
    localOnly: true,
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "context-xray",
      displayName: "Context X-Ray",
      description:
        "Visualize local Codex and Claude Code context usage with warnings and optimization tips.",
      hosted: {
        url: "https://context-xray.agent-native.com",
        mcpUrl: "https://context-xray.agent-native.com/_agent-native/mcp",
      },
      mcp: { serverName: "agent-native-context-xray" },
      auth: { mode: "none" },
      surfaces: [
        {
          id: "context-xray-report",
          path: "/",
        },
      ],
      skills: [
        {
          path: "skills/context-xray",
          visibility: "exported",
          exportAs: "context-xray",
        },
      ],
      hostAdapters: ["plain-skill", "claude-skill"],
    }),
    skillMarkdown: CONTEXT_XRAY_SKILL_MD,
  },
} satisfies Record<
  string,
  {
    manifest: AppSkillManifest;
    skillMarkdown: string;
    skillName: string;
    extraSkills?: Record<string, string>;
    localOnly?: boolean;
  }
>;

type BuiltInAppSkillId = keyof typeof BUILT_IN_APP_SKILLS;

const BUILT_IN_APP_SKILL_ALIASES = {
  assets: "assets",
  asset: "assets",
  "asset-generation": "assets",
  images: "assets",
  image: "assets",
  "image-generation": "assets",
  "agent-native-assets": "assets",
  "agent-native-images": "assets",
  design: "design",
  "ui-design": "design",
  "ux-design": "design",
  "design-exploration": "design",
  "ux-exploration": "design",
  "agent-native-design": "design",
  "agent-native-design-exploration": "design",
  "visual-plans": "visual-plans",
  "visual-plan": "visual-plans",
  "visual-recap": "visual-plans",
  "visual-recaps": "visual-plans",
  "code-review-recap": "visual-plans",
  "code-review-recaps": "visual-plans",
  "html-plan": "visual-plans",
  "plan-mode": "visual-plans",
  plannotate: "visual-plans",
  plannotator: "visual-plans",
  "agent-native-visual-plans": "visual-plans",
  "context-xray": "context-xray",
  "local-context-xray": "context-xray",
  xray: "context-xray",
  "context-window": "context-xray",
  "context-usage": "context-xray",
  "agent-native-context-xray": "context-xray",
} satisfies Record<string, BuiltInAppSkillId>;

const BUILT_IN_APP_SKILL_DISPLAY_ALIASES = {
  assets: ["images", "image-generation", "agent-native-images"],
  design: [
    "design-exploration",
    "ux-exploration",
    "agent-native-design-exploration",
  ],
  "visual-plans": [
    "visual-plan",
    "visual-recap",
    "code-review-recap",
    "html-plan",
    "plannotate",
  ],
  "context-xray": ["xray", "context-window", "context-usage"],
} satisfies Record<BuiltInAppSkillId, string[]>;

const CLIENT_LABELS: Record<ClientId, string> = {
  "claude-code": "Claude Code",
  "claude-code-cli": "Claude Code CLI",
  codex: "Codex",
  cowork: "Claude Cowork",
};

const CLIENT_HINTS: Record<ClientId, string> = {
  "claude-code": ".mcp.json or ~/.claude.json",
  "claude-code-cli": ".mcp.json or ~/.claude.json",
  codex: "$CODEX_HOME/config.toml or ~/.codex/config.toml",
  cowork: "~/.cowork/mcp.json",
};

type SkillsCommand = "list" | "add" | "help";

export interface ParsedSkillsArgs {
  command: SkillsCommand;
  target?: string;
  client: string;
  clientExplicit: boolean;
  clients?: ClientId[];
  scope: string;
  yes: boolean;
  dryRun: boolean;
  printJson: boolean;
  instructions: boolean;
  mcp: boolean;
  /**
   * Run the browser/device auth flow after registering a hosted MCP connector
   * so the user does not hit an OAuth wall on the first tool call. Default true;
   * `--no-connect` opts out and leaves authentication for the host/`agent-native
   * connect`.
   */
  connect: boolean;
  /**
   * Optional MCP URL override. When set, the skill's hosted MCP connector is
   * registered against this URL instead of the built-in hosted default — e.g.
   * an ngrok tunnel, a local dev origin, or a self-hosted deployment.
   */
  mcpUrl?: string;
  /**
   * When installing the visual-plan skill, also write the PR Visual Recap
   * GitHub Action workflow into `.github/workflows/` so PRs get automatic
   * recaps. Only applies to the `visual-plan` target.
   */
  withGithubAction?: boolean;
}

export interface SkillsAddResult {
  id: string;
  displayName: string;
  instructionSource?: string;
  skillNames: string[];
  skillsAgents: string[];
  mcpUrl: string;
  mcpClients: ClientId[];
  dryRun: boolean;
  commands: string[];
  local?: boolean;
  scriptPath?: string;
  written?: string[];
  /**
   * True when the install also kicked off (or prepared) the browser/device auth
   * flow for the hosted MCP connector. False when connect was skipped
   * (`--no-connect`, no-auth skills, or non-interactive without a connect step).
   */
  connected?: boolean;
  /**
   * The exact `agent-native connect <url>` command to run when interactive auth
   * was skipped (non-interactive shell / CI). Empty when connect ran inline or
   * was not needed.
   */
  connectCommand?: string;
  /**
   * When `--with-github-action` installed the PR Visual Recap workflow, the
   * repo-relative path it was written to (and whether it overwrote an existing
   * file).
   */
  githubActionPath?: string;
  githubActionExisted?: boolean;
}

interface SkillInstallTarget {
  id: string;
  displayName: string;
  loaded: LoadedAppSkillManifest;
  skillNames: string[];
  materializeInstructions(outDir: string): string;
  cleanup?: () => void;
}

interface RunCommandOptions {
  stdio?: "inherit" | "stderr" | "silent";
}

interface RunSkillsOptions {
  baseDir?: string;
  isInteractive?: () => boolean;
  log?: (message: string) => void;
  promptClients?: (
    context: SkillsClientPromptContext,
  ) => Promise<ClientId[] | null>;
  promptSkills?: (
    context: SkillsTargetPromptContext,
  ) => Promise<string[] | null>;
  runCommand?: (
    cmd: string,
    args: string[],
    options?: RunCommandOptions,
  ) => Promise<number>;
  /**
   * Injectable connect/auth entrypoint (defaults to the real `agent-native
   * connect`). Tests stub this so the install flow does not perform a real
   * browser/device OAuth round-trip.
   */
  runConnect?: (args: string[]) => Promise<void>;
}

interface SkillsClientPromptContext {
  initialClients: ClientId[];
  options: Array<{ value: ClientId; label: string; hint: string }>;
}

interface SkillsTargetPromptContext {
  initialTargets: string[];
  options: Array<{ value: string; label: string; hint: string }>;
}

function normalizeKnownSkillTarget(
  value: string | undefined,
): BuiltInAppSkillId | undefined {
  const key = value?.trim().toLowerCase();
  if (!key) return undefined;
  return BUILT_IN_APP_SKILL_ALIASES[key];
}

function isKnownSkill(value: string | undefined): boolean {
  return Boolean(normalizeKnownSkillTarget(value));
}

function isLocalOnlyBuiltInSkill(
  entry: (typeof BUILT_IN_APP_SKILLS)[BuiltInAppSkillId] | null | undefined,
): boolean {
  return Boolean(entry && "localOnly" in entry && entry.localOnly);
}

function builtInExtraSkills(
  entry: (typeof BUILT_IN_APP_SKILLS)[BuiltInAppSkillId],
): Record<string, string> {
  return "extraSkills" in entry && entry.extraSkills ? entry.extraSkills : {};
}

function builtInSkillNames(
  entry: (typeof BUILT_IN_APP_SKILLS)[BuiltInAppSkillId],
): string[] {
  return [entry.skillName, ...Object.keys(builtInExtraSkills(entry))];
}

function normalizeClientIds(values: unknown): ClientId[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<ClientId>();
  const out: ClientId[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.toLowerCase();
    if (!(CLIENTS as string[]).includes(id)) continue;
    const client = id as ClientId;
    if (seen.has(client)) continue;
    seen.add(client);
    out.push(client);
  }
  return out;
}

function clientPromptOptions(): SkillsClientPromptContext["options"] {
  return CLIENTS.map((client) => ({
    value: client,
    label: CLIENT_LABELS[client],
    hint: CLIENT_HINTS[client],
  }));
}

function skillPromptOptions(): SkillsTargetPromptContext["options"] {
  return Object.values(BUILT_IN_APP_SKILLS).map((entry) => ({
    value: entry.skillName,
    label: entry.manifest.displayName,
    hint: entry.manifest.description,
  }));
}

function shouldPrompt(parsed: ParsedSkillsArgs, options: RunSkillsOptions) {
  if (parsed.yes || parsed.printJson) return false;
  if (options.isInteractive) return options.isInteractive();
  if (process.env.AGENT_NATIVE_NO_PROMPT === "1") return false;
  if (process.env.CI === "true") return false;
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

async function promptForClients(
  context: SkillsClientPromptContext,
): Promise<ClientId[] | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.multiselect({
    message:
      "Install the MCP connector for which local agents?\n" +
      "  (space toggles, enter confirms; saved for next time)",
    options: context.options,
    initialValues: context.initialClients,
    required: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return normalizeClientIds(result);
}

async function promptForSkills(
  context: SkillsTargetPromptContext,
): Promise<string[] | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.multiselect({
    message:
      "Which Agent Native skills do you want to install?\n" +
      "  (space toggles, enter confirms)",
    options: context.options,
    initialValues: context.initialTargets,
    required: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  if (!Array.isArray(result)) return [];
  return result.filter((value): value is string => typeof value === "string");
}

async function resolveSkillsClients(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): Promise<ClientId[] | null> {
  if (parsed.clientExplicit || !shouldPrompt(parsed, options)) {
    return resolveClients(parsed.client);
  }
  const initialClients =
    readConnectClientPreferences() ?? resolveClients("codex");
  const prompt = options.promptClients ?? promptForClients;
  const selected = normalizeClientIds(
    await prompt({
      initialClients,
      options: clientPromptOptions(),
    }),
  );
  if (selected.length === 0) return null;
  if (!parsed.dryRun) {
    try {
      writeConnectClientPreferences(selected);
    } catch {}
  }
  return selected;
}

async function resolveSkillTargets(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): Promise<string[] | null> {
  if (parsed.target || !shouldPrompt(parsed, options)) {
    return [parsed.target ?? "assets"];
  }
  const prompt = options.promptSkills ?? promptForSkills;
  const selected = await prompt({
    initialTargets: ["assets"],
    options: skillPromptOptions(),
  });
  if (!selected || selected.length === 0) return null;
  return selected;
}

export function parseSkillsArgs(argv: string[]): ParsedSkillsArgs {
  const first = argv[0];
  let command: SkillsCommand = "list";
  let args = argv;
  if (first === "help" || first === "--help" || first === "-h") {
    command = "help";
    args = argv.slice(1);
  } else if (first === "list" || first === "add") {
    command = first;
    args = argv.slice(1);
  } else if (first) {
    command = "add";
  }

  const out: ParsedSkillsArgs = {
    command,
    client: "codex",
    clientExplicit: false,
    scope: "user",
    yes: false,
    dryRun: false,
    printJson: false,
    instructions: true,
    mcp: true,
    connect: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eat = (flag: string): string | undefined => {
      if (arg === flag) {
        const next = args[++i];
        if (!next || next.startsWith("-")) {
          throw new Error(`Missing value for ${flag}.`);
        }
        return next;
      }
      if (arg.startsWith(`${flag}=`)) {
        const value = arg.slice(flag.length + 1);
        if (!value) throw new Error(`Missing value for ${flag}.`);
        return value;
      }
      return undefined;
    };
    let value: string | undefined;
    if ((value = eat("--client")) !== undefined) {
      out.client = value;
      out.clientExplicit = true;
    } else if ((value = eat("--scope")) !== undefined) out.scope = value;
    else if ((value = eat("--mcp-url")) !== undefined) out.mcpUrl = value;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.printJson = true;
    else if (arg === "--mcp-only") out.instructions = false;
    else if (arg === "--instructions-only" || arg === "--no-mcp")
      out.mcp = false;
    else if (arg === "--no-connect" || arg === "--skip-connect")
      out.connect = false;
    else if (arg === "--with-github-action" || arg === "--with-github-actions")
      out.withGithubAction = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!out.target) out.target = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (out.scope !== "user" && out.scope !== "project") {
    throw new Error("--scope must be either user or project.");
  }
  return out;
}

function loadSkillTarget(target: string): SkillInstallTarget {
  const knownTarget = normalizeKnownSkillTarget(target);
  if (knownTarget) {
    const builtIn = BUILT_IN_APP_SKILLS[knownTarget];
    const skillNames = builtInSkillNames(builtIn);
    return {
      id: builtIn.manifest.id,
      displayName: builtIn.manifest.displayName,
      loaded: {
        manifest: builtIn.manifest,
        file: `<built-in:${builtIn.manifest.id}>`,
        dir: process.cwd(),
      },
      skillNames,
      materializeInstructions(outDir) {
        const skills: Record<string, string> = {
          [builtIn.skillName]: builtIn.skillMarkdown,
          ...builtInExtraSkills(builtIn),
        };
        for (const [skillName, skillMarkdown] of Object.entries(skills)) {
          const skillDir = path.join(outDir, "skills", skillName);
          fs.mkdirSync(skillDir, { recursive: true });
          fs.writeFileSync(
            path.join(skillDir, "SKILL.md"),
            skillMarkdown,
            "utf-8",
          );
        }
        return outDir;
      },
    };
  }

  const resolved = path.resolve(target);
  const manifestFile = fs.statSync(resolved).isDirectory()
    ? path.join(resolved, "agent-native.app-skill.json")
    : resolved;
  const loaded = loadAppSkillManifest(manifestFile);
  return {
    id: loaded.manifest.id,
    displayName: loaded.manifest.displayName,
    loaded,
    skillNames: loaded.manifest.skills
      .filter(
        (skill) =>
          skill.visibility === "exported" || skill.visibility === "both",
      )
      .map((skill) => skill.exportAs ?? path.basename(skill.path)),
    materializeInstructions(outDir) {
      const packed = buildAppSkillPack(loaded, outDir);
      const vercelAdapter = path.join(
        packed.outDir,
        "adapters",
        "vercel-skills",
      );
      return fs.existsSync(vercelAdapter) ? vercelAdapter : packed.outDir;
    },
  };
}

function skillsAgentsForClients(clients: ClientId[]): string[] {
  const agents = new Set<string>();
  for (const client of clients) {
    if (client === "codex") agents.add("codex");
    if (client === "claude-code" || client === "claude-code-cli") {
      agents.add("claude-code");
    }
  }
  return [...agents];
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_/:=.,@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandString(cmd: string, args: string[]): string {
  return [cmd, ...args].map(shellArg).join(" ");
}

function clientArgForClients(clients: ClientId[]): string {
  if (clients.length === CLIENTS.length) return "all";
  if (clients.length === 1) return clients[0];
  return clients.join(",");
}

function preserveMcpUrlAppPathOverride(
  target: SkillInstallTarget,
  input: string | undefined,
): SkillInstallTarget {
  if (!input) return target;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return target;
  }
  const trimmedPath = parsed.pathname.replace(/\/+$/, "");
  const appPath = trimmedPath.endsWith("/_agent-native/mcp")
    ? trimmedPath.slice(0, -"/_agent-native/mcp".length).replace(/\/+$/, "")
    : trimmedPath;
  if (!appPath) return target;
  const url = `${parsed.origin}${appPath}`;
  return {
    ...target,
    loaded: {
      ...target.loaded,
      manifest: {
        ...target.loaded.manifest,
        hosted: { url, mcpUrl: `${url}/_agent-native/mcp` },
      },
    },
  };
}

function dryRunInstallCommand(
  parsed: ParsedSkillsArgs,
  target: string,
): string {
  const clients = parsed.clients ?? resolveClients(parsed.client);
  const args = [
    "skills",
    "add",
    target,
    "--client",
    clientArgForClients(clients),
    "--scope",
    parsed.scope,
  ];
  if (parsed.mcpUrl) args.push("--mcp-url", parsed.mcpUrl);
  if (parsed.instructions && !parsed.mcp) args.push("--instructions-only");
  if (!parsed.instructions && parsed.mcp) args.push("--mcp-only");
  if (!parsed.connect) args.push("--no-connect");
  if (parsed.yes || isKnownSkill(target)) args.push("--yes");
  return commandString("agent-native", args);
}

async function runCommand(
  cmd: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const pipeToStderr = options.stdio === "stderr";
    const silent = options.stdio === "silent";
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const child = spawn(cmd, args, {
      stdio: pipeToStderr || silent ? ["inherit", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    if (pipeToStderr) {
      child.stdout?.on("data", (chunk) => process.stderr.write(chunk));
      child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
    } else if (silent) {
      child.stdout?.on("data", (chunk) =>
        stdoutChunks.push(Buffer.from(chunk)),
      );
      child.stderr?.on("data", (chunk) =>
        stderrChunks.push(Buffer.from(chunk)),
      );
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${cmd} was interrupted by ${signal}.`));
        return;
      }
      if (silent && code !== 0) {
        for (const chunk of stdoutChunks) process.stderr.write(chunk);
        for (const chunk of stderrChunks) process.stderr.write(chunk);
      }
      resolve(code ?? 0);
    });
  });
}

/**
 * Resolve a `--mcp-url` override into the `{ url, mcpUrl }` pair the manifest
 * expects. Accepts a bare origin (`https://x.ngrok-free.dev`) — appending the
 * standard `/_agent-native/mcp` path — or a full MCP URL already ending in it.
 */
function resolveMcpUrlOverride(input: string): { url: string; mcpUrl: string } {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`--mcp-url must be a valid URL (got "${input}").`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--mcp-url must use http:// or https://.");
  }
  const origin = parsed.origin;
  const trimmedPath = parsed.pathname.replace(/\/+$/, "");
  const mcpUrl = trimmedPath.endsWith("/_agent-native/mcp")
    ? `${origin}${trimmedPath}`
    : `${origin}/_agent-native/mcp`;
  return { url: origin, mcpUrl };
}

/** Return a copy of the install target with its hosted MCP URL overridden. */
function withMcpUrlOverride(
  target: SkillInstallTarget,
  input: string,
): SkillInstallTarget {
  const { url, mcpUrl } = resolveMcpUrlOverride(input);
  return {
    ...target,
    loaded: {
      ...target.loaded,
      manifest: { ...target.loaded.manifest, hosted: { url, mcpUrl } },
    },
  };
}

/**
 * Whether we can run the interactive browser/device auth flow. CI and
 * non-TTY shells must not block on a browser approval, so we skip the inline
 * flow there and surface the exact `agent-native connect` command instead.
 */
function canRunInteractiveConnect(options: RunSkillsOptions): boolean {
  if (options.isInteractive) return options.isInteractive();
  if (process.env.AGENT_NATIVE_NO_PROMPT === "1") return false;
  if (process.env.CI === "true") return false;
  return !!process.stdin.isTTY && !!process.stdout.isTTY;
}

/** Build the `agent-native connect <url> --client … --scope …` command. */
function connectCommandFor(
  hostedUrl: string,
  clients: ClientId[],
  scope: string,
): string {
  const args = [
    "connect",
    hostedUrl,
    "--client",
    clientArgForClients(clients),
    "--scope",
    scope,
  ];
  return commandString("agent-native", args);
}

/**
 * Authenticate the freshly-registered hosted MCP connector so the user does not
 * hit the OAuth wall on their first tool call. Reuses the existing
 * `agent-native connect` flow (OAuth-capable clients get URL-only config plus a
 * `/mcp` authenticate prompt; Codex / Cowork run the browser device-code flow).
 * In non-interactive shells we skip the inline flow and return the command to
 * run instead. Failures here are non-fatal: the connector is already registered,
 * so the user can authenticate later.
 */
async function connectAfterEnsure(
  installTarget: SkillInstallTarget,
  clients: ClientId[],
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): Promise<{ connected: boolean; connectCommand: string }> {
  const hostedUrl = installTarget.loaded.manifest.hosted.url;
  const authMode = installTarget.loaded.manifest.auth?.mode ?? "oauth";
  const connectCommand = connectCommandFor(hostedUrl, clients, parsed.scope);

  // Skills whose connector needs no auth (e.g. open/local-only) never need the
  // connect step.
  if (authMode === "none") {
    return { connected: false, connectCommand: "" };
  }

  if (!canRunInteractiveConnect(options)) {
    options.log?.(
      `Authentication skipped (non-interactive). To finish auth, run: ${connectCommand}`,
    );
    return { connected: false, connectCommand };
  }

  options.log?.(`Authenticating ${installTarget.displayName}…`);
  try {
    await (options.runConnect ?? runConnect)([
      hostedUrl,
      "--client",
      clientArgForClients(clients),
      "--scope",
      parsed.scope,
    ]);
    return { connected: true, connectCommand: "" };
  } catch (err: any) {
    // Non-fatal: the MCP connector is registered. Surface the manual command.
    options.log?.(
      `Could not finish authentication automatically (${err?.message ?? err}). ` +
        `Run it later with: ${connectCommand}`,
    );
    return { connected: false, connectCommand };
  }
}

export async function addAgentNativeSkill(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions = {},
): Promise<SkillsAddResult> {
  const target = parsed.target ?? "assets";
  const knownTarget = normalizeKnownSkillTarget(target);
  if (!knownTarget && !fs.existsSync(path.resolve(target))) {
    throw new Error(
      `Unknown skill or manifest path: ${target}. Run "agent-native skills list".`,
    );
  }
  const knownBuiltIn = knownTarget ? BUILT_IN_APP_SKILLS[knownTarget] : null;
  if (isLocalOnlyBuiltInSkill(knownBuiltIn)) {
    if (parsed.mcpUrl) {
      throw new Error(
        "Context X-Ray is installed locally and does not use --mcp-url yet.",
      );
    }
    if (!parsed.instructions && parsed.mcp) {
      throw new Error(
        "Context X-Ray does not need MCP config yet. Run without --mcp-only.",
      );
    }
    const clients = parsed.clients ?? resolveClients(parsed.client);
    const skillsAgents = skillsAgentsForClients(clients);
    if (parsed.dryRun) {
      return {
        id: knownBuiltIn.manifest.id,
        displayName: knownBuiltIn.manifest.displayName,
        skillNames: [knownBuiltIn.skillName],
        skillsAgents,
        mcpUrl: "",
        mcpClients: [],
        dryRun: true,
        local: true,
        commands: [dryRunInstallCommand(parsed, target)],
      };
    }
    const localInstall = installLocalContextXray({
      baseDir: options.baseDir ?? process.cwd(),
      clients,
      scope: parsed.scope,
    });
    return {
      id: knownBuiltIn.manifest.id,
      displayName: knownBuiltIn.manifest.displayName,
      instructionSource: localInstall.scriptPath,
      skillNames: [knownBuiltIn.skillName],
      skillsAgents,
      mcpUrl: "",
      mcpClients: [],
      dryRun: false,
      local: true,
      scriptPath: localInstall.scriptPath,
      written: localInstall.written,
      commands: localInstall.commands,
    };
  }
  let installTarget = loadSkillTarget(target);
  if (parsed.mcpUrl) {
    installTarget = withMcpUrlOverride(installTarget, parsed.mcpUrl);
  }
  const clients = parsed.clients ?? resolveClients(parsed.client);
  installTarget = preserveMcpUrlAppPathOverride(installTarget, parsed.mcpUrl);
  const skillsAgents = skillsAgentsForClients(clients);
  if (parsed.dryRun) {
    try {
      return {
        id: installTarget.id,
        displayName: installTarget.displayName,
        skillNames: installTarget.skillNames,
        skillsAgents,
        mcpUrl: installTarget.loaded.manifest.hosted.mcpUrl,
        mcpClients: clients,
        dryRun: true,
        commands: [dryRunInstallCommand(parsed, target)],
      };
    } finally {
      installTarget.cleanup?.();
    }
  }
  const commands: string[] = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-add-"));
  let instructionSource: string | undefined;
  let connected = false;
  let connectCommand: string | undefined;

  try {
    if (parsed.instructions) {
      if (skillsAgents.length === 0) {
        if (!parsed.mcp) {
          throw new Error(
            "Skill instructions can only be installed for Codex or Claude Code clients. Use an MCP-capable client or omit --instructions-only.",
          );
        }
      } else {
        instructionSource = installTarget.materializeInstructions(tmpRoot);
        const args = [
          "--yes",
          "skills@latest",
          "add",
          instructionSource,
          "--copy",
          ...installTarget.skillNames.flatMap((skill) => ["--skill", skill]),
          ...skillsAgents.flatMap((agent) => ["-a", agent]),
          ...(parsed.scope === "user" ? ["-g"] : []),
          ...(parsed.yes || knownTarget ? ["-y"] : []),
        ];
        commands.push(commandString("npx", args));
        if (!parsed.dryRun) {
          const code = await (options.runCommand ?? runCommand)("npx", args, {
            stdio: "silent",
          });
          if (code !== 0)
            throw new Error(`npx skills add exited with ${code}.`);
        }
      }
    }

    if (parsed.mcp) {
      commands.push(
        `agent-native app-skill ensure --manifest ${installTarget.loaded.file} --client ${parsed.client} --scope ${parsed.scope} --yes`,
      );
      if (!parsed.dryRun) {
        await ensureAppSkill(installTarget.loaded, {
          clients,
          scope: parsed.scope,
          baseDir: options.baseDir,
          yes: parsed.yes || Boolean(knownTarget),
          confirm: true,
          log: options.log,
        });

        // One-step install + authenticate: after registering a hosted MCP
        // connector, kick off the existing connect/device-code flow so the user
        // does not hit an OAuth wall on the first tool call. `--no-connect`
        // opts out; non-interactive shells get the exact command to run.
        if (parsed.connect) {
          const result = await connectAfterEnsure(
            installTarget,
            clients,
            parsed,
            options,
          );
          connected = result.connected;
          connectCommand = result.connectCommand || undefined;
          if (connectCommand) commands.push(connectCommand);
        }
      }
    }

    // `--with-github-action`: also drop the PR Visual Recap workflow into the
    // repo so PRs get automatic recaps. Only meaningful for the plan family.
    let githubActionPath: string | undefined;
    let githubActionExisted: boolean | undefined;
    if (parsed.withGithubAction) {
      if (knownTarget !== "visual-plans") {
        options.log?.(
          "--with-github-action only applies to the visual-plan skill; skipping the workflow.",
        );
      } else {
        const written = writePrVisualRecapWorkflow(
          options.baseDir ?? process.cwd(),
        );
        githubActionPath = written.path;
        githubActionExisted = written.existed;
        commands.push(`write ${written.path}`);
      }
    }

    return {
      id: installTarget.id,
      displayName: installTarget.displayName,
      instructionSource,
      skillNames: installTarget.skillNames,
      skillsAgents,
      mcpUrl: installTarget.loaded.manifest.hosted.mcpUrl,
      mcpClients: clients,
      dryRun: parsed.dryRun,
      commands,
      connected,
      connectCommand,
      githubActionPath,
      githubActionExisted,
    };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    installTarget.cleanup?.();
  }
}

function listSkills() {
  return Object.values(BUILT_IN_APP_SKILLS).map((entry) => ({
    id: entry.manifest.id,
    aliases:
      BUILT_IN_APP_SKILL_DISPLAY_ALIASES[
        entry.manifest.id as BuiltInAppSkillId
      ] ?? [],
    name: entry.manifest.displayName,
    description: entry.manifest.description,
    mcpUrl: isLocalOnlyBuiltInSkill(entry) ? "" : entry.manifest.hosted.mcpUrl,
    local: isLocalOnlyBuiltInSkill(entry),
  }));
}

export async function runSkills(
  argv: string[],
  options: RunSkillsOptions = {},
): Promise<void> {
  const parsed = parseSkillsArgs(argv);
  const log = parsed.printJson
    ? undefined
    : (message: string) => process.stdout.write(`${message}\n`);

  if (parsed.command === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  if (parsed.command === "list") {
    const skills = listSkills();
    if (parsed.printJson) {
      process.stdout.write(`${JSON.stringify(skills, null, 2)}\n`);
      return;
    }
    for (const skill of skills) {
      const description = skill.description.replace(/[.?!]?$/, ".");
      const aliases = skill.aliases.length
        ? ` Aliases: ${skill.aliases.join(", ")}.`
        : "";
      const target = skill.local ? "local command" : skill.mcpUrl;
      process.stdout.write(
        `${skill.id.padEnd(12)} ${description}${aliases} (${target})\n`,
      );
    }
    return;
  }

  const targets = await resolveSkillTargets(parsed, options);
  if (!targets) return;
  const clients = await resolveSkillsClients(parsed, options);
  if (!clients) return;

  const results: SkillsAddResult[] = [];
  for (const target of targets) {
    results.push(
      await addAgentNativeSkill(
        {
          ...parsed,
          target,
          client: clientArgForClients(clients),
          clients,
        },
        {
          ...options,
          log,
        },
      ),
    );
  }

  if (parsed.printJson) {
    process.stdout.write(
      `${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`,
    );
    return;
  }

  if (parsed.dryRun) {
    process.stdout.write(
      `${results.flatMap((result) => result.commands).join("\n")}\n`,
    );
    return;
  }

  const installedNames = results.map((result) => result.displayName).join(", ");
  const skillsAgents = [
    ...new Set(results.flatMap((result) => result.skillsAgents)),
  ];
  const mcpClients = [
    ...new Set(results.flatMap((result) => result.mcpClients)),
  ];
  const mcpUrls = [
    ...new Set(results.map((result) => result.mcpUrl).filter(Boolean)),
  ];
  const localCommands = [
    ...new Set(
      results
        .filter((result) => result.local)
        .flatMap((result) => result.commands),
    ),
  ];
  const authConnected = results.some((result) => result.connected);
  const pendingConnectCommands = [
    ...new Set(
      results
        .map((result) => result.connectCommand)
        .filter((command): command is string => Boolean(command)),
    ),
  ];
  const authLine = authConnected
    ? "Authentication: completed."
    : pendingConnectCommands.length
      ? `Authentication: pending — run ${pendingConnectCommands.join(" && ")}`
      : "";
  const githubActions = [
    ...new Set(
      results
        .map((result) => result.githubActionPath)
        .filter((p): p is string => Boolean(p)),
    ),
  ];
  const githubActionLine = githubActions.length
    ? `PR Visual Recap workflow: wrote ${githubActions.join(", ")}.\nSet these GitHub repo secrets/variables for it to run:\n  ${PR_VISUAL_RECAP_SETUP.join("\n  ")}`
    : "";
  process.stdout.write(
    [
      `Installed ${installedNames} skill${results.length === 1 ? "" : "s"}.`,
      skillsAgents.length
        ? `Skill instructions: ${skillsAgents.join(", ")}.`
        : "Skill instructions: skipped.",
      mcpClients.length
        ? `MCP config: ${mcpClients.join(", ")}.`
        : "MCP config: not required.",
      mcpUrls.length
        ? `MCP URL${mcpUrls.length === 1 ? "" : "s"}: ${mcpUrls.join(", ")}.`
        : "",
      authLine,
      githubActionLine,
      localCommands.length ? `Local command: ${localCommands.join(", ")}.` : "",
      "Restart or reload selected agent clients if the skill is not visible yet.",
      parsed.clientExplicit
        ? ""
        : `To add another client later, rerun with --client <client> (for example: --client claude-code).`,
    ]
      .filter(Boolean)
      .join("\n") + "\n",
  );
}
