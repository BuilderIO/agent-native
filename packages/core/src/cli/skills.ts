/**
 * `agent-native skills` is the friendly install surface for app-backed skills.
 * The lower-level `app-skill` commands remain the packaging primitives; this
 * command handles the common "install Assets for my agent" path in one step.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createCliTelemetry, type CliTelemetry } from "./telemetry.js";
import {
  buildAppSkillPack,
  ensureAppSkill,
  loadAppSkillManifest,
  normalizeAppSkillManifest,
  type AppSkillManifest,
  type LoadedAppSkillManifest,
} from "./app-skill.js";
import {
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

const HELP = `npx @agent-native/core@latest skills

Usage:
  npx @agent-native/core@latest skills list
  npx @agent-native/core@latest skills status [assets|design-exploration|visual-plan|visual-recap|context-xray] [--client codex|claude-code|all] [--scope user|project] [--json]
  npx @agent-native/core@latest skills update [assets|design-exploration|visual-plan|visual-recap|context-xray] [--client codex|claude-code|all] [--scope user|project] [--dry-run] [--json]
  npx @agent-native/core@latest skills add assets|design-exploration|visual-plan|visual-recap|context-xray [--client codex|claude-code|claude-code-cli|cowork|all] [--scope user|project] [--mcp-url <url>] [--no-connect] [--with-github-action] [--yes] [--dry-run] [--json]
  npx @agent-native/core@latest skills add <manifest-or-app-dir|skill-repo> [--skill <name>] [--client ...] [--yes]

Examples:
  npx @agent-native/core@latest skills add assets
  npx @agent-native/core@latest skills add design-exploration
  npx @agent-native/core@latest skills add visual-plan
  npx @agent-native/core@latest skills add visual-recap
  npx @agent-native/core@latest skills add visual-recap --with-github-action
  npx @agent-native/core@latest skills status visual-plan
  npx @agent-native/core@latest skills update visual-plan
  npx @agent-native/core@latest skills add visual-plan --no-connect
  npx @agent-native/core@latest skills add context-xray --client all
  npx @agent-native/core@latest skills add assets --client claude-code
  npx @agent-native/core@latest skills add assets --mcp-url https://my-app.ngrok-free.dev
  npx @agent-native/core@latest skills add ./dist/assets-skill --client codex
  npx @agent-native/core@latest skills add BuilderIO/skills --client codex --scope project
  npx @agent-native/core@latest skills add BuilderIO/skills --with-github-action

The add command installs the SKILL.md instructions, registers the app-backed
MCP connector, and then authenticates it in one step so you do not hit an OAuth
wall on the first tool call. By default, add targets every supported local
client this CLI can configure (Claude Code, Claude Code CLI, Codex, and Cowork);
pass --client to narrow it. Authentication reuses "npx @agent-native/core@latest connect":
OAuth-capable clients (Claude Code) get a URL-only entry and a /mcp authenticate
prompt, while Codex / Cowork run the browser device-code flow. In a
non-interactive shell or CI the auth step is skipped and the exact
"npx @agent-native/core@latest connect <url> --client all" command is printed instead.

Running "npx @agent-native/skills@latest add ..." directly installs instructions only;
use this Agent Native CLI path when you want MCP setup and auth too. Pass --no-connect to
register the connector without authenticating (leave auth to the host or run
"npx @agent-native/core@latest connect" later). Pass --mcp-url to register that connector against
a custom origin (an ngrok tunnel, a local dev server, or a self-hosted
deployment) instead of the built-in hosted default — a bare origin gets the
standard /_agent-native/mcp path appended. Use app-skill pack for marketplace
bundles and custom adapter output.

When installing visual-recap interactively, the CLI offers to add the optional PR
Visual Recap GitHub Action. Pass --with-github-action to write it directly, then
run "npx @agent-native/core@latest recap setup" / "npx @agent-native/core@latest recap doctor" to configure and
verify GitHub Actions.

The status/update commands inspect copied Agent Native skill folders and refresh
their instruction files from the current @agent-native/core package.`;

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
- For CLI/code-editor clients, keep any \`npx @agent-native/core@latest connect\` command
  running until browser authorization finishes. Stopping it early can leave the
  browser approved but the local MCP config unwritten. Restart or reload the
  agent client after installing or connecting if Assets tools do not appear in
  the live session.
- Local customization: use \`npx @agent-native/core@latest app-skill launch --local\` from an
  Assets app-skill manifest, or pass \`--into <path>\` for editable source.
- Do not call image/video providers directly from another app. Assets owns
  generation, picker UI, search/list/export, and asset context.
- If an Assets tool call returns \`Session terminated\`, \`needs auth\`, or
  another connector/session error, do not keep retrying the tool. Stop and give
  the user the reconnect step: in Claude Code run \`/mcp\` and choose
  Authenticate/Reconnect for the Assets connector; from any terminal run
  \`npx -y @agent-native/core@latest reconnect https://assets.agent-native.com\` — this
  re-authenticates WITHOUT reinstalling. Never reinstall from scratch just to fix
  auth. Continue once the connector is available.
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
- For CLI/code-editor clients, keep any \`npx @agent-native/core@latest connect\` command
  running until browser authorization finishes. Stopping it early can leave the
  browser approved but the local MCP config unwritten. Restart or reload the
  agent client after installing or connecting if Design tools do not appear in
  the live session.
- Dispatch can expose Design alongside other apps. Use Design for UI/UX design
  tasks, Assets for image/media selection, Slides for decks, and so on.
- Keep the loop visual: surface the inline MCP App or the returned "Open
  design" link instead of pasting large HTML blobs into chat.
- If a Design tool call returns \`Session terminated\`, \`needs auth\`, or
  another connector/session error, do not keep retrying the tool. Stop and give
  the user the reconnect step: in Claude Code run \`/mcp\` and choose
  Authenticate/Reconnect for the Design connector; from any terminal run
  \`npx -y @agent-native/core@latest reconnect https://design.agent-native.com\` — this
  re-authenticates WITHOUT reinstalling. Never reinstall from scratch just to fix
  auth. Continue once the connector is available.
- Do not hand-roll MCP HTTP requests with curl from the agent session. Use the
  host-exposed Design tools after restart/reload, or use the returned
  browser/deep-link fallback.
- If you inspect local MCP config, redact \`Authorization\`, \`http_headers\`,
  and token values. Never paste bearer tokens into chat or logs.
`;

/**
 * Setup/auth block for the `/visual-plan` skill. Interpolated into
 * `VISUAL_PLANS_SKILL_MD` below so the install + one-step authenticate
 * instructions are single-sourced. The materialized SKILL.md copies under
 * `templates/plan/.agents/skills/*`, top-level `skills/*`, and
 * `.agents/skills/*` are guarded byte-identical by `skills.sync.spec.ts`.
 */
const PLAN_SETUP_AUTH_MD = `## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and runs
auth/setup for the selected local client(s) in the same step (a one-time browser
sign-in at setup — this is intended), so the first tool call in that client does
not hit an OAuth wall:

\`\`\`bash
npx @agent-native/core@latest skills add visual-plan
\`\`\`

After that, \`/visual-plan\` and \`/visual-recap\` are the two installed slash
commands. The other planning modes (\`create-ui-plan\`, \`create-prototype-plan\`,
\`create-plan-design\`, \`create-visual-questions\`) are MCP tools reachable from
\`/visual-plan\`, not separate slash commands. Pass \`--no-connect\` to register
the connector without authenticating, then run
\`npx @agent-native/core@latest connect https://plan.agent-native.com --client all\`
whenever you are ready, or choose a narrower \`--client\`. Auth and MCP tool
loading are per client config/session.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns \`needs auth\`, \`Unauthorized\`, or \`Session terminated\`,
do not keep retrying the tool. Stop and give the user the reconnect step for the
client they are using: Codex/Codex Desktop should run
\`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex\`
and start a new Codex session; Claude Code should run \`/mcp\` and choose
Authenticate/Reconnect for the plan connector, or run the reconnect command with
\`--client claude-code\` and restart Claude. To refresh every local client config
that already has the Plan entry, use \`--client all\`, then restart/reload each
client. Reconnect re-authenticates WITHOUT reinstalling and finds the entry by
URL regardless of connector name. Never reinstall from scratch just to fix auth.
Continue once the connector is available.

Hosted default: connect \`https://plan.agent-native.com/_agent-native/mcp\`. Do
not put shared secrets in skill files.`;

// Single-source shared cores. Each partial is a heading-less BODY string that
// begins and ends with its own SHARED-CORE marker comment, so the marker-region
// sync guard can extract and compare it across the skills that consume it. The
// skill constants below interpolate these partials at module-eval time; the
// distributed artifact stays a flat string, so distribution is unchanged.
//
// Consumers:
//   WIREFRAME_QUALITY_CORE  — visual-plan, visual-recap (surface-agnostic)
//   CANVAS_SURFACE_CORE     — visual-plan modes (canvas/artboard mechanics)
//   DOCUMENT_QUALITY_CORE   — visual-plan
//   EXEMPLAR_CORE           — visual-plan

// Surface-agnostic HTML wireframe quality rules. Applies equally to a standalone
// WireframeBlock/<Screen> (visual-recap) and to a canvas artboard (visual-plan).
// Do not put canvas/artboard placement mechanics here.
const WIREFRAME_QUALITY_CORE = `<!-- SHARED-CORE:wireframe-quality START -->

**A wireframe is an HTML mockup. The renderer owns the look; you write the
content.** Set \`data.html\` to a self-contained, semantic HTML fragment of the
screen and set \`data.surface\`. The renderer owns the surface footprint/aspect,
the dark/light theme, the hand-drawn font, and the rough.js sketch overlay — you
never write \`<html>\`/\`<body>\`/\`<script>\`/\`<style>\` tags or any
width/height/coordinates. You write real HTML layout and real product
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

**Use renderer icons, not visible icon words.** For icon-only buttons or leading
icons inside fields, chips, menu items, and toolbars, write an empty marker such
as \`<span data-icon="mail" aria-label="Email"></span>\` or
\`<i data-icon="lock"></i>\`. The renderer replaces it with a Tabler-style SVG and
the \`.wf-icon\` class sizes it to the surrounding text. Supported names and
aliases: \`mail\`/\`email\`, \`lock\`/\`password\`, \`search\`, \`plus\`/\`add\`, \`x\`/\`close\`,
\`check\`, \`chevronDown\`, \`chevronUp\`, \`chevronLeft\`, \`chevronRight\`, \`dots\`/\`more\`,
\`chevron\`/\`caret\`/\`dropdown\` (down chevron), \`user\`, \`settings\`, \`calendar\`,
\`bell\`, \`send\`, \`edit\`, \`arrowLeft\`, and \`arrowRight\`. Do not put visible words
like "email", "lock", "search", "chevron", or "more" where the product UI would
show an icon; use text only when it is a real label a user would read.

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
layout. For net-new surfaces, compose from the real app shell. Inspect the
actual app components before drawing an existing product: sidebar density,
toolbar actions, overflow menus, property panels, and framework chrome should
match the product unless the plan intentionally changes them.

**Keep product screens pure.** A product wireframe shows the app state a user
would actually see. Do not embed file contracts, architecture arrows, repo pills,
mode explanations, or implementation callouts inside the screen just to explain
the plan. Put those in canvas annotations, a separate diagram, or the document
body. Secondary UI such as properties, history, sync, export, or agent controls
should appear where the real product would put them: an overflow popover, sheet,
panel, or separate framework sidebar state, not a generic permanent right
inspector unless that inspector is the actual design.

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
existing html mockup, call \`update-visual-plan\`
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

**Name the states with the column header, never inside the frame.** For
document-body wireframes (recaps), put the two
states in a \`columns\` block and set each column's \`label\` to \`Before\` and
\`After\` — the renderer draws that label as an \`h4\` heading above each frame. Do
NOT bake a \`Before\`/\`After\` pill, title, or heading into the wireframe \`html\`: a
label placed inside reads as part of the product UI, lands in a random corner,
and clutters the comparison. The column header is the one and only place the
state name belongs. On a canvas, place the two state artboards as neighbors with
frame labels — never encode Before/After inside the html.

**Let the surface choose side-by-side vs. stacked.** For document-body
wireframes (recaps), the \`columns\` renderer lays
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

// Progressive-disclosure reference file. `WIREFRAME_QUALITY_CORE` is the single
// source of truth for HTML wireframe quality; it is materialized verbatim into a
// sibling `references/wireframe.md` in EVERY plan skill dir (visual-plan and
// visual-recap), instead of being interpolated inline into each SKILL.md body.
// The SKILL.md bodies carry only `WIREFRAME_REFERENCE_POINTER`, which tells the
// agent to read this file before authoring any wireframe. Keeping the reference
// body byte-identical to the core (markers included) lets the sync guard assert
// the on-disk copies never drift from the canonical constant.
export const WIREFRAME_REFERENCE_MD = `# HTML wireframe quality — single source of truth

This file is the canonical quality bar for HTML wireframes / \`<Screen>\` /
\`WireframeBlock\` content, shared word for word by \`/visual-plan\` and
\`/visual-recap\`. Read it in full before authoring ANY wireframe; do not
author wireframes from memory or paraphrase these rules per command.

${WIREFRAME_QUALITY_CORE}
`;

// Short pointer that replaces the inline wireframe-quality core in each SKILL.md
// body. Authoring quality lives in the sibling reference file so the SKILL.md
// stays lean (progressive disclosure); the agent loads the detail on demand.
const WIREFRAME_REFERENCE_POINTER = `UI recap/plan wireframes must meet a strict quality bar — full-width chrome,
pinned bottom bars, real product content, before/after comparability, the right
\`surface\` preset, \`--wf-*\` tokens instead of hex, and no \`<html>\`/\`<style>\`/font
tags. Before authoring ANY wireframe / \`<Screen>\` / \`WireframeBlock\`, READ
\`references/wireframe.md\` in this skill directory — it is the single source of
truth for HTML wireframe quality, shared word for word with \`/visual-plan\`
and \`/visual-recap\`. Do not author wireframes from memory.`;

// Canvas/artboard placement mechanics. Used only by visual-plan modes
// (visual-recap renders standalone wireframes, not a canvas).
const CANVAS_SURFACE_CORE = `<!-- SHARED-CORE:canvas-surface START -->

**The coordinate rule.** The \`surface\` locks each artboard's footprint and
aspect — never set artboard width/height and never use coordinates inside the
wireframe HTML; board-level artboard \`x\`/\`y\` IS allowed when it creates clear
lanes. Let canvas auto-placement handle simple one-row boards.

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
Never send a partial top-level \`content\` object as a shortcut to add a canvas,
frame, or block: \`content\` is a full structured replacement, so omitted blocks
or surfaces can disappear. If a full replacement is truly unavoidable, read the
complete source/JSON first, include every existing block and surface in the new
payload, and verify the source/export immediately after the update.

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
top surface shows Wireframes / Prototype tabs. Architecture/code diagrams stay
inline in the document (the SKILL.md Visual Surface Choice section owns that
rule) unless the user explicitly asks for a spatial board. Document blocks
can explain, compare, or map implementation, but they should not host the
primary UI mockup or prototype just because \`custom-html\`, screenshots, or prose
are easier to produce. If the canvas/prototype surface cannot represent the
requested UI fidelity, still keep the closest top-surface representation and
call out or extend the needed renderer capability. A skeleton/loading mockup
also lives in a canvas artboard — never move a mockup out of the canvas.

For abstract product concepts, use the canvas to create the first "I get it"
moment: one real app state near the top showing how the concept appears to a
user, followed by separate annotations or diagrams for mechanics. Do not make
the first artboard a hybrid of app UI and architecture notes; the app screen
should be inspectable as product UI on its own.

**Legacy kit tree.** Older plans set a \`screen\` array of \`{ el, ...props }\` kit
nodes instead of \`html\`; the renderer still accepts and displays it, but new
plans emit \`html\`. Do not author fresh kit-tree screens - write the HTML mockup
instead. Likewise, old or imported plans may carry coordinate-based regions or
free-float x/y on notes; those are legacy escape hatches the renderer still
shows but you must never produce. The gutter parks notes by \`targetId\` +
\`placement\`, and the coordinate rule at the top of this file governs all
new-plan placement.

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

**Every published plan must stand alone.** Even when the agent is revising an
existing plan, the output is a plan to do the work, not a changelog of the
conversation. Do not write phrases like "preserve the previous plan", "do not
drop the old idea", "as discussed above", "this revision", "unlike the prior
version", or "correction from the earlier plan". Fold the right decisions into
the plan as normal objective, architecture, scope, and roadmap prose. A reviewer
who opens the plan from a link with no chat history should understand it. Avoid
negative framing that only makes sense against absent context ("not the old
mode", "not just X") unless the contrast is defined in the plan and genuinely
helps; state the positive model directly.

**Make abstract plans instantly legible.** If the idea is broad, strategic, or
intended for a third-party reviewer, put one concrete product snapshot near the
top before dense architecture, mode tables, manifests, or roadmaps. For
UI-capable concepts, that snapshot is usually a top-canvas app state plus a
short paragraph that says what the user sees and what changes under the hood.
Then put mechanics, data flow, sync boundaries, and implementation detail in
separate diagrams or document sections.

**Preserve the user's level of abstraction.** A motivating use case is not
automatically the architecture. When the prompt describes a broader framework,
product mode, or reusable primitive, separate the reusable core from specific
apps, providers, customers, scripts, or launch examples. Use the concrete
example to make the plan understandable, then make clear which parts are core,
which are app-specific adapters, and which are future examples.

**When top visuals exist, they and the document never duplicate each other.**
For UI work, the UI story lives in the top visual surface: canvas artboards for
static inspection, plus prototype tabs when the flow should be functional. The
document carries the technical depth the visuals cannot show — concrete
file/symbol maps, API and data contracts, code snippets, migration or
implementation phases, risks, and validation. For architecture/code reviews,
invert that: the document is the visual surface, and each recommendation
carries its own nearby inline \`diagram\` / \`data-model\` block plus file
evidence (the \`diagram\` bullet below owns how to author those diagrams).
Repeat a wireframe in the document only for a genuinely new detail view or
comparison. Skip the visual surface entirely for non-visual work and write a
clean rich document. For a simple binary UI visual choice, show the two
directions in the canvas only; do not repeat the same options as body
wireframes or prose. Put the actual choice in the bottom "Open Questions" form.

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
  relationships, only when it clarifies something real. Prefer standard
  two-dimensional layouts — paired before/after panels, layered diagrams,
  swimlanes, dependency maps, matrices, or grouped regions; do not default to
  left-to-right chains, and use a line only when the relationship is truly a
  sequence. For architecture/code
  diagrams, prefer \`data.html\` / \`data.css\` with semantic HTML and inline SVG so
  the diagram can use panels, layers, matrices, arrows, annotations, and
  responsive layout directly. Author diagram HTML with renderer-owned primitives
  like \`.diagram-panel\`, \`.diagram-card\`, \`.diagram-node\`, \`.diagram-box\`,
  \`.diagram-pill\`, \`.diagram-muted\`, and \`[data-rough]\`; they map to the plan's
  Tailwind theme variables through \`--wf-ink\`, \`--wf-muted\`, \`--wf-line\`,
  \`--wf-paper\`, \`--wf-card\`, \`--wf-accent\`, \`--wf-accent-soft\`, \`--wf-warn\`, and
  \`--wf-ok\`, and switch to Excalifont plus rough.js outlines in sketchy mode. Do not
  set \`font-family\` and do not hard-code hex, rgb, or hsl colors in diagram HTML
  or CSS. Leave room for the sketch font: keep labels short, give nodes generous
  width, and place boundary/annotation labels in unused space instead of over
  nodes; labels must not overlap nodes, connectors, or each other. For small
  text/SVG changes to an existing HTML diagram, use \`patch-diagram-html\` with a
  unique \`find\`/\`replace\` snippet instead of resending the whole \`data.html\`
  string. Use legacy \`nodes\` / \`edges\` only for small previews or truly
  sequential flows. In architecture/code plans, prefer a repeated section rhythm:
  recommendation title, confidence and category badges, code-path evidence, a
  local before/after or current/target spatial diagram, then concise
  Problem/Solution/Why text.
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

For complex plans, do not end without an open-question audit. If architecture,
scope, UX, data shape, rollout, provider mapping, or ownership still depends on
a choice, either commit to a recommendation with rationale or add it to the
bottom form with a recommended default. A complex plan with no open questions is
fine only when every meaningful decision has been explicitly made.

**Verification must exercise the real workflow.** The final verification section
should go beyond typecheck/unit tests when the plan changes UI, local files,
sync, providers, browser behavior, or multi-app flows. Include at least one
end-to-end smoke that matches the user journey, such as a fresh repo/folder,
real manifest or data fixture, browser interaction, save/sync action, and an
on-disk or database assertion. Name the command or manual browser path when it
is known.

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

**GOOD.** A UI-first plan for a todo app: a canvas with a \`desktop\` artboard whose
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

**GOOD.** A broad product-architecture plan opens with a plain recommendation
and one concrete app state before the abstraction. The first canvas artboard is
pure product UI that matches the current app shell; nearby notes explain the
user-visible delta. A separate diagram below shows the mechanics, such as file
or data flow. The document then separates the reusable core from app/provider
adapters and examples, covers contracts, folder or schema shape, sync
boundaries, roadmap, non-goals, a bottom Open Questions form for unresolved
decisions, and a verification section with at least one realistic end-to-end
smoke. A reviewer who was not in the chat gets the idea from the top snapshot
before reading the technical plan.

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
recommendations live elsewhere; a product wireframe that mixes a real screen
with repo names, file-contract arrows, architecture explanations, or a made-up
permanent inspector; and a plan that describes itself as a revision of a prior
conversation instead of a standalone proposal. Never produce this.

<!-- SHARED-CORE:exemplar END -->`;

// Progressive-disclosure reference files. Like `WIREFRAME_REFERENCE_MD`, each of
// the canvas / document-quality / exemplar cores is the single source of truth
// for its topic and is materialized verbatim into a sibling `references/*.md`
// file in the visual-plan skill dir instead of being interpolated inline into
// the SKILL.md body. The body carries only the matching `*_REFERENCE_POINTER`.
// Keeping each reference body byte-identical to its core (markers included) lets
// the sync guard assert the on-disk copies never drift from the constant.
export const CANVAS_REFERENCE_MD = `# Canvas & artboard placement — single source of truth

This file is the canonical guide for how the visual-plan canvas works: artboard
placement, lane layout, annotations, patching, and the legacy kit tree. Read it
in full before authoring or editing any canvas/artboard content; do not author
canvas layouts from memory or paraphrase these rules per mode.

${CANVAS_SURFACE_CORE}
`;

export const DOCUMENT_QUALITY_REFERENCE_MD = `# Plan document quality — single source of truth

This file is the canonical quality bar for the plan document below the canvas:
how it reads, which blocks to use, how open questions are surfaced, and the
pre-handoff check. Read it in full before authoring the plan document; it is the
quality bar. Do not write the document from memory or paraphrase these rules per
mode.

${DOCUMENT_QUALITY_CORE}
`;

export const EXEMPLAR_REFERENCE_MD = `# Good vs. bad exemplar — single source of truth

This file is the canonical worked example of a great plan (and the anti-patterns
to avoid). Read it alongside the document-quality and canvas references before
authoring a plan; it is the bar these plans must clear.

${EXEMPLAR_CORE}
`;

// Short pointers that replace the inline canvas / document-quality / exemplar
// cores in the SKILL.md body. Authoring detail lives in the sibling reference
// files so the SKILL.md stays lean (progressive disclosure); the agent loads the
// detail on demand.
const CANVAS_REFERENCE_POINTER = `The canvas is the single source of truth for static UI mockups: the \`surface\`
locks each artboard's footprint, mixed surfaces lay out
in lanes, annotations are plain-text designer notes anchored by
\`targetId\`/\`placement\`, and edits are surgical \`contentPatches\`. Before
authoring or editing ANY canvas, artboard, or annotation, READ
\`references/canvas.md\` in this skill directory — it is the single source of truth
for canvas/artboard mechanics. Do not author canvas layouts from memory.`;

const DOCUMENT_QUALITY_REFERENCE_POINTER = `The document is a serious technical plan, not marketing: outcome-first,
prose-first, self-contained, built from the right native blocks, with open
questions in a single bottom \`question-form\` and a pre-handoff visual check.
Before authoring the plan document, READ \`references/document-quality.md\` in this
skill directory — it is the single source of truth for the document quality bar.
Do not write the document from memory.`;

const EXEMPLAR_REFERENCE_POINTER = `For a worked example of the bar — a great UI-first plan and \`/visual-plan\`, plus
the anti-patterns to avoid — READ \`references/exemplar.md\` in this skill
directory before authoring a plan.`;

export const VISUAL_PLANS_SKILL_MD = `---
name: visual-plan
description: >-
  Turn ordinary text plans into rich interactive visual plans with diagrams,
  file maps, annotated code, open questions, and UI/prototype review when
  useful.
metadata:
  visibility: exported
---

# Agent-Native Plans

Agent-Native Plans is structured visual planning mode for coding agents. Build
the plan you would normally write in Markdown, but as a scannable document with
editable blocks mixed in: inline diagrams, code snippets,
open questions, and an optional top visual review area (wireframe canvas, live
prototype, or both in tabs). Architecture and backend plans stay document-only;
UI and product plans start with the top canvas/prototype (the Visual Surface
Choice section owns that rule).

\`/visual-plan\` is the packaged command and main entry point. Choose the review
mode from the task: UI-first when the work is primarily product UI and review
should start with screens, prototype-first when review should start with a
functional live prototype, design-first when review needs full-fidelity branded
screens, or visual-intake when the user explicitly wants a questionnaire before
planning. When a Codex, Claude Code, Markdown, or pasted plan already exists,
\`/visual-plan\` uses that source plan as the starting point and builds the review
surface from it instead of starting over.

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
- **Keep examples at the right altitude.** When the user's idea is a broad
  framework, product, or operating-model change, do not collapse it into the
  first concrete example, provider, or sync path they mention. Separate the core
  abstraction from motivating examples and app/provider adapters. Use examples
  to make the plan legible, but label them as examples unless they are the whole
  requested scope.
- **Publish standalone plans.** If the user pasted, referenced, or already has a
  Codex / Claude Code / Markdown plan, treat it as source material, but rewrite
  the published plan as a clean standalone proposal. Preserve the source plan's
  useful intent and codebase facts, label inferred visuals as inferred, and avoid
  revision language such as "preserve the prior plan", "do not drop the old
  idea", "unlike the previous version", or "this revision changes...". A reader
  who never saw the chat or earlier drafts should understand the plan.
- **Make the first read concrete.** If the plan is meant to be shared with
  someone outside the chat, or if the concept is abstract, lead near the top with
  one concrete product example before mode tables, architecture, or roadmaps. For
  UI-capable concepts, that usually means a top-canvas app state that shows the
  real user workflow in product terms. Do not rely on phrases that only make
  sense in conversation, and do not frame the plan as "not the old idea"; state
  the positive model directly.
- **Planning is read-only.** Make no source edits while building or reviewing the
  plan. Start editing only after the user approves the direction.
- **Clarify vs. assume.** Do not ask how to build it — explore and present the
  approach and options in the plan. Ask a clarifying question only when an
  ambiguity would change the design and you cannot resolve it from the code; use
  the host agent's normal ask-user-question flow and batch 2-4 high-leverage
  questions before finalizing. Do not call \`create-visual-questions\` from
  \`/visual-plan\`. Otherwise state the assumption explicitly and proceed, and
  keep anything unresolved in the plan's single bottom \`question-form\` Open
  Questions block. For complex plans, do a final open-question pass before
  handoff: if a decision would affect architecture, scope, UX, data shape, or
  rollout, either decide it in the plan with rationale or put it in that bottom
  form with a recommended default.
- **The plan is the approval gate.** After surfacing it, ask the user to review
  and approve before you write code, and name which files/areas the work touches.
  Presenting the plan and requesting sign-off is the approval step — do not ask a
  separate "does this look good?" question.
- **The document is the source of truth, not the chat.** When scope shifts,
  update the plan with \`update-visual-plan\` rather than only changing course in
  chat, and make the updated document stand alone. Do not describe the update as
  a correction to an earlier draft inside the plan itself. Re-read the approved
  plan before major steps.

## Always Publish As An Agent-Native Plan — Never Inline

The deliverable is ALWAYS a published Agent-Native Plan created via the Plan
MCP connector (\`plan\` server, or legacy \`agent-native-plans\`). NEVER hand the
plan over as inline chat content — no Markdown prose, ASCII sketch, table, or
fenced wireframe. If the connector's tools are missing, do NOT fall back to
inline output: the usual cause is a connector that did not finish connecting
this session (it registers zero tools), not auth. Stop and give the user the
exact restore step for their current client: in Codex/Codex Desktop run
\`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex\`
and start a new Codex session; in Claude Code run \`/mcp\` and choose
Authenticate/Reconnect (or run the same reconnect command with
\`--client claude-code\` and restart Claude). Auth is stored per client
config/session, so one client's reconnect does not make another running client
load tools. Never reinstall from scratch just to fix auth. Publish once the tool
is reachable. Local-files privacy mode (after Tool Guidance) is the only
exception.

## Core Workflow

1. Follow the host agent's normal planning flow: inspect the codebase, delegate
   wide exploration when useful, gather the info needed, and ask native
   clarifying questions as needed before generating the plan. If a source plan
   already exists, gather its exact text from the user's paste, a referenced
   file, or recent visible agent context; do not invent source text.
2. Call \`get-plan-blocks\` for the authoritative block catalog — do not author
   from memorized tags. Then call the mode-matched create tool:
   \`create-visual-plan\` for document-first plans (architecture, backend, data,
   refactor, API), \`create-ui-plan\` for UI-first plans, \`create-prototype-plan\`
   for prototype-first plans, \`create-plan-design\` for design-first plans,
   \`create-visual-questions\` only when the user explicitly asks for a visual
   intake questionnaire. When a source plan already exists,
   pass it as \`planText\` and preserve the original plan's useful intent while
   producing a standalone plan document, not a revision memo.
3. For UI/product plans, compose the top canvas first with the primary
   wireframes and annotated states, then write the document with native blocks
   (see \`references/canvas.md\` and \`references/document-quality.md\`). For
   broad product architecture plans with a user-facing implication, add a
   concrete "what this looks like in the app" visual before the abstract
   architecture or mode tables. Keep the document close to the standalone
   Markdown plan the agent would normally output. If an existing plan was
   provided, carry forward the right facts and decisions without referring to
   the previous draft or explaining how this version differs. For non-visual
   plans, skip the top visual surface (Visual Surface Choice below owns the rule)
   and put \`diagram\`, \`data-model\`,
   \`api-endpoint\`, \`diff\`, \`file-tree\`, \`code\`, and \`annotated-code\` blocks
   directly next to the relevant prose.
4. Surface the returned Plans link or inline MCP App and ask the user to review.
   Always include the actual URL in chat so the next step is a click in CLI or
   other text-only hosts. When the host exposes an embedded browser/preview panel
   and a tool can open arbitrary URLs there, open the returned plan URL
   automatically for convenient review — a convenience and smoke test, never the
   only handoff or the access
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
   Treat the top-level \`content\` payload as a full replacement, not a merge; do
   not send a partial \`content\` object to add a canvas or one block. If a full
   replacement is unavoidable, first read the complete plan source/content, carry
   forward every existing block and visual surface, and verify the source/export
   afterward so the document body was not truncated. When the user wants
   source-control friendly edits, use \`patch-visual-plan-source\` against the MDX
   files instead of regenerating the plan.
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

For UI/product plans, the top canvas is usually the primary review surface. Put
the first meaningful wireframes there, not buried as document-body blocks. Use
multiple canvas artboards when states matter, such as the default view, an
overflow menu or popover, a side panel, loading, or error. Put short annotations
beside frames with \`targetId\` plus \`placement\`; keep implementation details,
tradeoffs, file maps, data contracts, risks, and verification in the document
body below the canvas.

Keep product wireframes and explanatory/meta diagrams separate. Start with pure
screens that look like the app state under discussion, without callout prose or
architecture notes embedded inside the UI. Put arrows, labels, contracts, data
flow, and mode explanations in separate annotations, separate canvas diagrams,
or the document body.

When the plan touches an existing app, inspect the current shell/components
before drawing. The first artboard should look like the real app at the same
density: existing sidebars, toolbar placement, overflow menus, app chrome, and
framework agent chrome stay in their real places. Model secondary surfaces as
separate states, such as a top-right overflow popover, sheet, panel, loading
state, or separate AgentSidebar, rather than inventing a permanent inspector or
folding framework chrome into the product UI.

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
- **Prototype-first** when the user asks to operate the UI or when interaction is
  the main question. Use \`create-prototype-plan\`, which still preserves static
  mocks where useful.

For mixed canvas + prototype plans, reuse the same real labels, app statuses,
and screen ids across both surfaces. The canvas is the inspectable static reference;
the prototype is the interactive version of that same flow, not a separate
design direction.

## Wireframe quality — read \`references/wireframe.md\`

UI recap/plan wireframes must meet a strict quality bar — full-width chrome,
pinned bottom bars, real product content, before/after comparability, the right
\`surface\` preset, \`--wf-*\` tokens instead of hex, and no \`<html>\`/\`<style>\`/font
tags. Before authoring ANY wireframe / \`<Screen>\` / \`WireframeBlock\`, READ
\`references/wireframe.md\` in this skill directory — it is the single source of
truth for HTML wireframe quality, shared word for word with \`/visual-plan\`
and \`/visual-recap\`. Do not author wireframes from memory.

## Canvas — read \`references/canvas.md\`

The canvas is the single source of truth for static UI mockups: the \`surface\`
locks each artboard's footprint, mixed surfaces lay out
in lanes, annotations are plain-text designer notes anchored by
\`targetId\`/\`placement\`, and edits are surgical \`contentPatches\`. Before
authoring or editing ANY canvas, artboard, or annotation, READ
\`references/canvas.md\` in this skill directory — it is the single source of truth
for canvas/artboard mechanics. Do not author canvas layouts from memory.

## Document quality — read \`references/document-quality.md\`

The document is a serious technical plan, not marketing: outcome-first,
prose-first, self-contained, built from the right native blocks, with open
questions in a single bottom \`question-form\` and a pre-handoff visual check.
Before authoring the plan document, READ \`references/document-quality.md\` in this
skill directory — it is the single source of truth for the document quality bar.
Do not write the document from memory.

## Good vs. bad exemplar — read \`references/exemplar.md\`

For a worked example of the bar — a great UI-first plan and \`/visual-plan\`, plus
the anti-patterns to avoid — READ \`references/exemplar.md\` in this skill
directory before authoring a plan.

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
- \`create-visual-questions\`: use only when the user explicitly asks for a visual
  intake questionnaire, not as \`/visual-plan\` preflight.
- \`update-visual-plan\`: revise content, status, or comments with targeted
  \`contentPatches\` (see Core Workflow step 6).
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
- \`get-plan-blocks\`: resolve block tags before authoring — do not memorize tags;
  call this first to get the authoritative tag names, required fields, and prop
  shapes from the live block registry.
- \`export-visual-plan\`: export HTML, Markdown fallback, structured JSON, and MDX
  files for repo check-in.

When the user critiques a plan's look or structure, fix the renderer or this
skill — never hand-edit one stored plan. Turn feedback into better guidance.

## Local-Files Privacy Mode

Use local-files privacy mode when the user explicitly asks for no DB writes,
no hosted Plan app, no Plan MCP publish, fully local files, offline/private
planning, or when \`AGENT_NATIVE_PLANS_MODE=local-files\` is set. In this mode the
plan data must never be sent to the Plan MCP server or Plan app action surface.

The local-files contract is:

- Read source context from local files and shell commands only.
- Write the plan as a local MDX folder under \`plans/<slug>/\`: \`plan.mdx\`,
  optional \`canvas.mdx\`, optional \`prototype.mdx\`, and optional
  \`.plan-state.json\`.
- Run \`npx @agent-native/core@latest plan local preview --dir plans/<slug> --kind plan\` after
  writing or updating the folder. Report the returned local URL or the
  \`/local-plans/<slug>\` route if the local Plan app is running with the same
  \`PLAN_LOCAL_DIR\`.
- Do **not** call \`create-visual-plan\`, \`create-ui-plan\`,
  \`create-prototype-plan\`, \`create-plan-design\`, \`import-visual-plan-source\`,
  \`update-visual-plan\`, \`patch-visual-plan-source\`, \`get-plan-feedback\`,
  \`export-visual-plan\`, or any hosted Plan tool for that plan.
- Treat feedback as file or chat feedback: update the MDX files directly, rerun
  the local preview command, and summarize the new local URL/path. Hosted
  comments, sharing, history, and publish/export receipts are unavailable until
  the user explicitly opts into publishing.

Local-files mode prevents plan content from going to the Agent-Native Plan
database. It does not by itself make the coding agent's language model local;
for that stronger privacy boundary, the host agent/model must also be local or
otherwise approved by the user.

## Interpreting comment anchors

\`get-plan-feedback\` returns rich anchors — read them before acting on any comment.

- **Coordinate frames.** \`targetX\`/\`targetY\` are percentages *within* the
  element named by \`targetSelector\`/\`targetKind\`. Bare \`x\`/\`y\` are percentages
  of the whole plan document. \`canvasX\`/\`canvasY\` are raw board-world pixels on
  the design canvas (board size given when available).
- **Wireframe pins.** Anchors on wireframes include \`targetNodeId\` and
  \`targetNodePath\` (e.g. \`card > list > listItem "Acme Inc"\`) identifying the
  exact kit node. Use \`targetNodeId\` directly with wireframe node patch ops;
  use \`data-design-id\` values from design artboards with
  \`update-design-element-style\`. Prefer the node id/path over raw coordinates;
  fall back to coordinates plus the focused screenshot (red ring marks the exact
  point) only when no node id is present.
- **Text quotes.** Resolve \`textQuote\` against current prose using
  \`contextBefore\`/\`contextAfter\` for disambiguation. If \`ambiguous: true\`, ask
  the user — do not guess which occurrence is meant.
- **Detached comments.** \`get-plan-feedback\` flags threads whose quoted text no
  longer exists as \`detached\` (in \`detachedThreads\`). Reconcile these against
  rewritten content — never silently drop them.
- **Routing.** \`resolutionTarget\` is the only routing signal: act on \`agent\`,
  treat \`human\` as context only. \`@mentions\` are people to notify, never a
  routing signal.
- **Two-axis state.** Mark every ingested comment as consumed
  (\`consumedCommentIds\` on \`update-visual-plan\`). Set \`status=resolved\` only on
  agent-targeted comments you actually addressed; leave human-targeted comments
  open.

## Visibility & Sharing

Use \`set-resource-visibility\` to change who can see a plan (e.g. public, login,
or org-scoped). Use \`share-resource\` to grant specific users or roles access
by email or role. Gate visibility before sharing any plan that covers
unreleased or private work — default to the narrowest scope that meets the
review need.

## Setup & Authentication

There are two ways into Plans.

**Coding agent (CLI).** Install once with the Agent-Native CLI. The command
installs the Plans skills, registers the hosted Plans MCP connector, and runs
auth/setup for the selected local client(s) in the same step (a one-time browser
sign-in at setup — this is intended), so the first tool call in that client does
not hit an OAuth wall:

\`\`\`bash
npx @agent-native/core@latest skills add visual-plan
\`\`\`

After that, \`/visual-plan\` and \`/visual-recap\` are the two installed slash
commands. The other planning modes (\`create-ui-plan\`, \`create-prototype-plan\`,
\`create-plan-design\`, \`create-visual-questions\`) are MCP tools reachable from
\`/visual-plan\`, not separate slash commands. Pass \`--no-connect\` to register
the connector without authenticating, then run
\`npx @agent-native/core@latest connect https://plan.agent-native.com --client all\`
whenever you are ready, or choose a narrower \`--client\`. Auth and MCP tool
loading are per client config/session.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For fully offline, no-account use, run the Plans app locally and sync plans to
your repo as MDX. This local mode is a separate advanced path, not the default
hosted flow.

If a Plans tool returns \`needs auth\`, \`Unauthorized\`, or \`Session terminated\`,
do not keep retrying the tool. Stop and give the user the reconnect step for the
client they are using: Codex/Codex Desktop should run
\`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex\`
and start a new Codex session; Claude Code should run \`/mcp\` and choose
Authenticate/Reconnect for the plan connector, or run the reconnect command with
\`--client claude-code\` and restart Claude. To refresh every local client config
that already has the Plan entry, use \`--client all\`, then restart/reload each
client. Reconnect re-authenticates WITHOUT reinstalling and finds the entry by
URL regardless of connector name. Never reinstall from scratch just to fix auth.
Continue once the connector is available.

Hosted default: connect \`https://plan.agent-native.com/_agent-native/mcp\`. Do
not put shared secrets in skill files.
`;

export const VISUAL_RECAP_SKILL_MD = `---
name: visual-recap
description: >-
  Turn a PR, branch, commit, or git diff into an interactive visual recap with
  diagrams, file maps, API/schema summaries, annotated diffs, and focused review
  notes.
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

## Local-Files Privacy Mode Exception

Use local-files privacy mode when the user explicitly asks for no DB writes,
no hosted Plan app, no Plan MCP publish, fully local files, offline/private
recaps, or when \`AGENT_NATIVE_PLANS_MODE=local-files\` is set. This is the only
exception to the hosted publish rule below.

In local-files mode:

- Read the diff/stat/source context from local files and shell commands only.
  The existing \`npx @agent-native/core@latest recap collect-diff\`, \`scan\`, and
  \`build-prompt --local-files\` helpers are safe to use because they operate on
  local files and do not write to the Plan database.
- Write the recap as a local MDX folder under \`plans/<slug>/\`: \`plan.mdx\`,
  optional \`canvas.mdx\`, optional \`prototype.mdx\`, and optional
  \`.plan-state.json\`. Set \`kind: "recap"\` and \`localOnly: true\` in
  frontmatter/state when authoring the source.
- Run \`npx @agent-native/core@latest plan local preview --dir plans/<slug> --kind recap\` after
  writing or updating the folder. Report the returned local URL or the
  \`/local-plans/<slug>\` route if the local Plan app is running with the same
  \`PLAN_LOCAL_DIR\`.
- Do **not** call \`create-visual-recap\`, \`create-visual-plan\`,
  \`import-visual-plan-source\`, \`update-visual-plan\`,
  \`patch-visual-plan-source\`, \`get-plan-feedback\`, \`export-visual-plan\`,
  \`set-resource-visibility\`, or any hosted Plan tool for that recap.
- Treat review feedback as file or chat feedback: update the MDX files directly,
  rerun the local preview command, and summarize the new local URL/path.
  Hosted comments, sharing, screenshots, usage attachment, and PR sticky comment
  publishing are unavailable until the user explicitly opts into publishing.

Local-files mode prevents recap content from going to the Agent-Native Plan
database. It does not by itself make the coding agent's language model local;
for that stronger privacy boundary, the host agent/model must also be local or
otherwise approved by the user.

## Always Publish As An Agent-Native Plan — Never Inline

The deliverable is ALWAYS a published Agent-Native Plan, created with the
\`create-visual-recap\` tool on the Plan MCP connector. The connector is usually
exposed as the \`plan\` server, but older installed agents may expose the same
hosted connector as \`agent-native-plans\`; both names are valid. NEVER hand the
recap to the user as inline chat content — not Markdown prose, not an ASCII
sketch, not a table, not a fenced "wireframe", not a "here's the recap" summary.
A recap's entire value is the hosted, interactive, annotatable plan; an inline
summary is not a recap, it is the thing a recap replaces. The only supported
output is to publish the plan and return its absolute URL.

Except for the explicit local-files privacy mode above, if neither the \`plan\`
nor legacy \`agent-native-plans\` Plan MCP tools are available, do NOT improvise an
inline recap as a fallback. Do not report the connector as disconnected just
because it is named \`agent-native-plans\` instead of \`plan\`. The usual cause is a
connector that did not finish connecting this session (it registers zero tools),
NOT necessarily an auth problem — so do not assume the user must authenticate.
Stop and tell the user how to restore it for their current client: in
Codex/Codex Desktop, run
\`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex\`
and start a new Codex session; in Claude Code, run \`/mcp\` and choose
Authenticate/Reconnect, or run the reconnect command with \`--client claude-code\`
and restart Claude. Auth is stored per client config/session; \`--client all\`
refreshes every local client config that already has the Plan entry, but each
running client still has to reload its MCP tools. Reconnect re-authenticates
WITHOUT reinstalling and finds the entry by URL regardless of connector name.
Never reinstall from scratch just to fix auth. Then publish once the tool is
reachable. Falling back to inline content is a defect, not a degraded mode.

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
brief, and \`file-tree\` (which carries the per-file change stats) already carry
that context.

Only add prose blocks when they tell the reviewer something specific about the
change that the structured blocks do not: the objective, a real compatibility
risk, an important decision visible in the diff, or a grounded review note.

## Recaps Must Be Substantial

Lean is not the same as thin. A recap is not a single wireframe plus one
sentence — that under-serves the reviewer as much as boilerplate prose over-serves
them. Alongside the visual/structural headline (wireframes, \`data-model\`,
\`api-endpoint\`, \`diagram\`), a substantial recap also carries the implementation
evidence:

- A short surface/state inventory before authoring: list the changed routes,
  components, popovers/dialogs, role/access states, empty/error states, and
  shared abstractions visible in the diff. The final recap must either represent
  each meaningful item with a block or intentionally omit it because it is tiny,
  redundant, or not user-visible.
- A \`file-tree\` of the changed files with each entry's \`change\` flag, so the
  reviewer sees the footprint of the work at a glance.
- The split \`diff\` of the KEY changed files, grouped under a \`## Key changes\`
  \`rich-text\` heading in a single horizontal \`tabs\` block (the default
  orientation, one file per tab), with a one-line \`summary\` and a few
  \`annotations\` on each — so the reviewer can drop from the high-altitude shape
  straight into the load-bearing code. Use horizontal file tabs, not a vertical
  side rail, so the selected file has enough width for the side-by-side diff.

Skip the diff appendix only for a genuinely tiny change that reviews faster as
plain diff (see "When To Use"); for any change worth recapping, the file-tree and
key-change diffs belong in the plan.

## Canonical Shape And Budgets

A strong recap follows one skeleton, top to bottom:

1. UI-impact headline — wireframes first, when the diff changed rendered UI.
2. Short outcome narrative (\`rich-text\`): what changed and why, 1-3 paragraphs.
3. \`data-model\` / \`api-endpoint\` blocks for schema and contract changes.
4. \`file-tree\` of the changed files with \`change\` flags.
5. \`## Key changes\` — one horizontal \`tabs\` block of \`diff\` / \`annotated-code\`.

Budgets that keep the recap reviewable:

- 3-8 key-change tabs. Fewer than 3 on a large change under-serves the
  reviewer; more than 8 stops being a summary.
- Keep each diff/annotated-code excerpt focused — prefer under ~150 lines per
  tab; summarize or link the rest of a long file instead of dumping it.
- Title at most ~70 characters; brief 1-3 sentences.

**GOOD.** A 25-file auth change: Before/After wireframes of the login surface,
a two-paragraph narrative, a diff-aware \`data-model\` of the sessions table, an
\`api-endpoint\` for the new refresh route, a \`file-tree\` with change flags, and
\`## Key changes\` with five focused tabs, each with a one-line \`summary\` and a
few annotations on the load-bearing hunks.

**BAD.** One giant unsegmented diff dump with no summaries or annotations; or a
sparse three-block recap of a 40-file change (one wireframe, one sentence, one
file list) that forces the reviewer back into the raw diff anyway.

## UI Impact Needs Wireframes

When the diff changes rendered UI, layout, density, visual state, interaction
affordances, navigation, controls, menus, dialogs, or design tokens, the recap
MUST include one or more wireframes. Prose and file diffs are not a substitute
for showing what changed visually.

Before choosing wireframes, make a UI coverage pass from the diff:

- Identify the entry surface where the change appears, such as a page header,
  list row, toolbar, route shell, or menu trigger.
- Identify the interaction surface that opens or changes, such as a popover,
  dialog, tab, sheet, dropdown, inline editor, or toast.
- Identify the resulting destination or persistent state, such as a public page,
  read-only view, empty state, error state, loading state, permission-denied
  state, or saved/shared state.
- Identify access or role variants when permissions change. Owner/admin/editor
  versus viewer/non-manager differences are visual behavior and need a compact
  matrix, paired wireframes, or clearly labeled state sequence.

For UI-heavy PRs, a single before/after of the entry surface is not enough.
Show the changed entry point, the main changed interaction surface, and the
resulting/destination state. Add more states when the diff adds tabs, role-based
controls, public/private visibility, invite/manage flows, destructive controls,
or empty/error branches.

Choose the smallest visual surface that makes the review clear:

- Use a \`Before\` / \`After\` wireframe pair when the reviewer benefits from direct
  comparison, such as a removed or added control, a changed state, layout
  density, ordering, navigation, or a visible component replacement.
  \`references/wireframe.md\` owns how to lay that pair out (columns vs.
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

## Wireframe Quality — read \`references/wireframe.md\`

UI recap/plan wireframes must meet a strict quality bar — full-width chrome,
pinned bottom bars, real product content, before/after comparability, the right
\`surface\` preset, \`--wf-*\` tokens instead of hex, and no \`<html>\`/\`<style>\`/font
tags. Before authoring ANY wireframe / \`<Screen>\` / \`WireframeBlock\`, READ
\`references/wireframe.md\` in this skill directory — it is the single source of
truth for HTML wireframe quality, shared word for word with \`/visual-plan\`
and \`/visual-recap\`. Do not author wireframes from memory.

Use the standard \`WireframeBlock\` / \`<Screen>\` format so the Plan viewer owns the
surface frame, theme, and sketchy/clean toggle. HTML wireframes are appropriate
when placement precision matters, especially popovers, menus, dialogs, and dense
forms. For HTML
wireframes, keep \`renderMode\` unset or \`wireframe\` unless a design-only editable
mockup is explicitly required, because \`renderMode="design"\` disables the
sketchy rough overlay.

When a browser tool is available, render a UI-impact recap in the Plan viewer
and visually inspect it at the current theme before sharing. If any label,
annotation, toolbar, or wireframe content overlaps another element, fix the MDX
and re-import before reporting the link. A text-match screenshot is not enough;
visually inspect the captured image. When no browser is available (for example
a headless CI agent), state that in the recap handoff instead.

## Open And Report The Recap

In local-files privacy mode, report the local preview URL/path from
\`npx @agent-native/core@latest plan local preview\` or the \`/local-plans/<slug>\` route for a local
Plan app using the same \`PLAN_LOCAL_DIR\`. Do not invent a hosted URL and do not
publish just to get an absolute Plan link.

After creating the recap, link the reviewer to the rendered plan with an
**absolute URL on the origin whose database actually holds the plan**. That
origin is the Plan MCP server you just created the recap through — NOT whatever
dev server you happen to know is running. The create tool returns the correct
link; report THAT. Never make the primary link a local \`plan.mdx\` file, a local
mirror folder, or a relative path such as \`/plans/<id>\`.

When the recap is posted to a PR for a private repo, the plan link is not a
public URL. Make the PR comment/handoff copy explicit: reviewers may need to
sign in to Agent-Native Plans with an account that has access to the owning
organization before the link loads. Use wording like: "Private repo recap:
sign in with access to this org if the plan does not open." Do not imply the
link is broken or public when access is gated by repo/org visibility.

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
the actual diff. The names below are the CONCEPTUAL block types, not the JSX
tags — resolve every conceptual name to its exact tag + prop schema with the
\`get-plan-blocks\` tool (see "Block reference" below) before authoring.

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
  default for recap code review because before/after legibility is the point;
  use \`mode: "unified"\` only for a genuinely narrow standalone hunk where
  side-by-side would hide the code. Give every \`diff\` a one-line \`summary\`
  saying what the hunk changes and why; it renders as a description above the
  code so the reviewer reads intent first. Never leave a diff unlabeled.
  For the KEY changed files, attach \`annotations\` to the \`diff\` so the recap
  calls out what each important hunk does — this is the headline affordance for
  annotating the key files updated. Each annotation anchors to the AFTER-side
  line numbers by default (set \`side: "before"\` to point at removed lines). Keep
  it to a few high-signal notes per file, not one per line.
  When several key files each need a substantial diff, introduce the group with a
  \`rich-text\` heading block whose markdown is \`## Key changes\`, then place the
  \`diff\` blocks under it in a reusable \`tabs\` block with horizontal orientation
  (the default — omit \`orientation\`) so the selected file's split diff gets the
  full document width. Let that heading label the section — do NOT also set a
  \`title\` on the \`tabs\` block. Keep each tab label to the file path or a short
  basename plus directory hint.
  If the recap ends with more than one supporting diff, that trailing diff
  appendix should be one horizontal \`tabs\` block under its own \`## Key changes\`
  heading, not a stack of separate \`diff\` blocks.
- **Brand-new file or a substantial added block with no meaningful "before"** →
  \`annotated-code\` rather than a one-sided split \`diff\`. Carry the real new code
  with its \`filename\` / \`language\` and anchor a few high-signal notes to the lines
  that matter so the reviewer reads what the new code does, not code for code's
  sake. Keep split \`diff\` for true before/after hunks where the removed lines
  still carry meaning, and group several annotated walkthroughs in a horizontal
  \`tabs\` block the same way diffs are grouped.
- **Files added / removed / renamed** → \`file-tree\` with each entry's \`change\`
  flag (\`added\`, \`removed\`, \`modified\`, \`renamed\`) and a short \`note\`; attach a
  \`snippet\` only when one tells the reviewer something the path does not.
- **Rendered UI / interaction change** → one or more wireframes showing the
  visible UI delta before the reviewer reads code. Use \`Before\` / \`After\`
  wireframes when the comparison clarifies the change; otherwise use after-only
  or a short state/flow sequence. Use realistic UI surfaces: for a popover
  change, show a popover with its title row, top-right actions, options/fields,
  tabs, selected/disabled states, people/lists/rows, and any opened prompt/menu
  anchored to the correct trigger. If a route was added, show the route body and
  the unavailable/empty state when the diff implements one. If permissions
  changed, show what managers can do and what viewers/non-managers see instead.
  Keep the body lean: the wireframe carries the UI story, while the file tree
  and \`diff\` blocks carry implementation evidence.
- **Architecture or data-flow shift** → \`diagram\` with \`data.html\` / \`data.css\`
  as a two-panel before/after, layered, or swimlane layout, or \`mermaid\` for a
  quick graph. Use two-dimensional layouts; do not reduce a structural change to
  a left-to-right chain. Do not use \`diagram\` as a stand-in for rendered UI
  controls; UI changes need \`wireframe\` blocks.
  Author diagram HTML/CSS with the renderer-owned \`.diagram-*\` primitives
  (\`.diagram-panel\`, \`.diagram-node\`, \`.diagram-pill\`, \`[data-rough]\`, …) and
  the same \`--wf-*\` theme tokens \`references/wireframe.md\` defines — never
  \`font-family\`, hex, rgb/hsl literals, or one-off dark/light palettes.
- **Outcome-first narrative** → \`rich-text\` for the "what changed and why" prose:
  the objective the diff served, the key decisions visible in it, and the risks a
  reviewer should weigh. This is the only place the model writes freely.

## Block reference — call \`get-plan-blocks\`, do not memorize tags

The conceptual block names above (\`api-endpoint\`, \`data-model\`, \`json-explorer\`,
\`tabs\`, …) are NOT the JSX tags you author with, and the exact tags, required
fields, and prop shapes change as the block library evolves. Do not author from
memorized tags — they drift and silently produce a wrong tag (\`ApiEndpoint\`
instead of \`Endpoint\`, \`JsonExplorer\` instead of \`Json\`, \`Tabs\` instead of
\`TabsBlock\`) that errors on import.

**Before writing any structured plan content, call \`get-plan-blocks\` on the Plan
MCP connector (\`plan\` or legacy \`agent-native-plans\`).** It returns the
authoritative, always-current block
vocabulary generated live from the app's own block registry — the same config
the renderer and MDX round-trip use — so it can never be stale even if this
SKILL.md is an old installed copy:

- \`get-plan-blocks\` (default \`format: "reference"\`) → a compact table of every
  block's runtime \`type\`, exact MDX \`<Tag>\`, placement, and key data fields.
  This is your map from each conceptual name above to its real tag and props.
- \`get-plan-blocks\` with \`format: "schema"\` → the full per-block JSON Schema
  plus a worked example for each block, when you need exact field types,
  enums, or nesting (e.g. \`Diff.annotations\`, \`Endpoint.params[].in\`,
  \`DataModel.entities[].fields[]\`).

Author the recap source against the tags and schemas that call returns. The
complete set of valid block-level tags is whatever \`get-plan-blocks\` lists;
any other capitalized tag at the block level is rejected on import with an
"Unknown plan block" / "did you mean" error. Lowercase HTML tags inside
\`rich-text\`/markdown prose (\`<div>\`, \`<span>\`, \`<code>\`, \`<br>\`, …) are always
fine — only capitalized component-style block tags are validated.

A few recap-specific authoring rules the registry table cannot encode:

- Every block takes a REQUIRED \`id\` (unique across the whole plan) plus the
  shared optional \`summary\` / \`editable\` envelope; give a block a heading by
  placing a \`rich-text\` block with a Markdown \`###\` heading directly above it
  (blocks no longer take a \`title\`).
- \`Endpoint\`: prose \`description\` is the MDX **children** (body between the
  tags), not an attribute; for a WebSocket upgrade use \`method="GET"\`. Each
  request/response \`example\` is a JSON **string** (the renderer parses it into
  the JSON explorer), so keep it a single parseable JSON value.
- \`TabsBlock\`: the whole \`tabs\` array (including nested child blocks) is ONE
  JSON \`tabs={[…]}\` prop — there is NO nested \`<Tab>\` element.
- \`WireframeBlock\`: its body is a single \`<Screen surface ... html=… />\` subtree
  (nested MDX, not a flat prop); \`html\` must be a single-quoted string or static
  template literal, never a dynamic \`html={someVar}\` expression. See
  \`references/wireframe.md\` for the HTML rules.
- \`Diagram\`: the whole payload is one \`data={{ html?, css?, nodes?, edges?, … }}\`
  attribute and requires either \`html\` or at least one node; \`Mermaid\` is its
  own separate block (\`source\` text), not a \`Diagram\` prop.

## Before / After Is The Headline

The recap's center of gravity is the before/after comparison. For document-body
comparisons there are two primitives, and they cover the whole need together:

- **\`columns\`** — the side-by-side container, for **structured** comparisons.
  Use two columns labeled \`Before\` and \`After\`, each holding a block (commonly a
  \`data-model\`, \`api-endpoint\`, or \`rich-text\`), so the reviewer reads the old
  shape against the new shape in one glance. This is the right primitive for
  "the schema went from X to Y" or "the endpoint contract changed like this."
  Do not use \`columns\` simply to compact or group a list of API endpoints.
- **\`diff\`** — for **code**. It renders the literal removed and added lines. Use
  it for the actual hunks. Use split mode by default for recap code review;
  reserve \`mode: "unified"\` for genuinely narrow standalone hunks where
  side-by-side would hide the code. Key-file diff groups should use horizontal
  tabs so split diffs get the full document width.

For UI diffs, wireframes are the visual comparison primitive. Use before/after
wireframes when the comparison clarifies the change; use after-only or a state
sequence when that better matches the change. The visual headline must show
exact placement, realistic chrome, and adequate padding before any abstract
explanation. Do not stop at the first visible affordance when the diff adds a
flow; show the entry point, the opened surface, and the resulting state or page
so the reviewer can trace the actual user path. \`references/wireframe.md\` owns
the before/after layout choice —
the \`columns\` renderer keeps narrow surfaces side by side and auto-stacks wide
\`desktop\`/\`browser\` frames vertically; never hand-build a side-by-side
wireframe layout in \`custom-html\`. For document-body
comparisons, there is no other multi-column primitive — \`columns\` plus the
\`diff\` block are the whole comparison vocabulary. Do not hand-build side-by-side
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
  the source it summarizes. Any PR comment or handoff that links to the recap
  must say that private-repo recaps require signing in with access to the owning
  org if the link does not load.
- **Never transcribe secrets.** A diff can contain API keys, tokens, webhook
  URLs, signing secrets, \`.env\` values, or credential-looking literals. Do not
  copy any of these into a \`diff\`, \`file-tree\` snippet, \`api-endpoint\`, or prose
  block — redact them (\`sk-•••\`, \`<redacted>\`). This mirrors the repo's
  hardcoded-secret rule: obviously fake placeholders only, never the real value,
  in any block, caption, or note.

## Bidirectional Loop

Because a recap is a real, editable plan, the same review loop as forward plans
applies: a reviewer can annotate any block, and the coding agent reads
\`get-plan-feedback\` to drive fixes back into the code — annotation → agent →
diff, the same close-the-loop flow forward plans use. After a reviewer annotates
a block, call \`get-plan-feedback\` to read the structured feedback, then either
update the recap with \`create-visual-recap\` (passing the existing \`planId\` to
replace it in place) or apply targeted changes with \`update-visual-plan\`. The
loop is live and wired. The one thing not yet automatic is PR-comment-triggered
re-runs: the GitHub Action creates an initial recap per PR, but it does not yet
re-run automatically when new review feedback is posted in GitHub — that
auto-re-run is the remaining fast-follow.

## Related Skills

- **visual-plan** — the canonical command and the source of the shared Wireframe
  & Canvas and Document Quality cores; a recap follows the same block discipline
  in reverse.
- **comment anchors** — recap comments use the same anchor rules as forward
  plans; see "Interpreting comment anchors" in the visual-plan skill for
  coordinate frames, wireframe node ids, text-quote resolution, detached
  threads, routing via \`resolutionTarget\`, and two-axis consumed/resolved state.
- **security** — data scoping, secret handling, and the hardcoded-secret rule the
  recap's redaction and visibility gating mirror.
- **sharing** — org/login-gated visibility for the plan that holds the recap.
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
    // Sibling reference files materialized alongside each skill's SKILL.md
    // (progressive disclosure). Keyed by skill name -> relative path -> content.
    // Both plan skills ship the same canonical wireframe-quality reference; the
    // canvas / document-quality / exemplar references are visual-plan only.
    extraFiles: {
      "visual-plan": {
        "references/wireframe.md": WIREFRAME_REFERENCE_MD,
        "references/canvas.md": CANVAS_REFERENCE_MD,
        "references/document-quality.md": DOCUMENT_QUALITY_REFERENCE_MD,
        "references/exemplar.md": EXEMPLAR_REFERENCE_MD,
      },
      "visual-recap": { "references/wireframe.md": WIREFRAME_REFERENCE_MD },
    },
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "visual-plans",
      displayName: "Agent-Native Plan",
      description:
        "Create rich interactive visual plans and recaps with diagrams, file maps, annotated code and diffs, API/schema summaries, feedback, and HTML export.",
      hosted: {
        url: "https://plan.agent-native.com",
        mcpUrl: "https://plan.agent-native.com/_agent-native/mcp",
      },
      mcp: { serverName: "plan", aliases: ["agent-native-plans"] },
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
            "Create a rich interactive visual plan instead of a plain-text plan, with diagrams, file maps, annotated code, questions, and optional UI/prototype review.",
        },
        {
          id: "visual-recap",
          action: "create-visual-recap",
          path: "/plans",
          description:
            "Create an interactive visual recap from a PR, commit, branch, or git diff so reviewers see the shape of the change before raw diff review.",
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
    /**
     * Extra sibling files materialized alongside a skill's SKILL.md, for
     * progressive disclosure (e.g. `references/wireframe.md`). Keyed by skill
     * name, then by skill-relative path -> file content.
     */
    extraFiles?: Record<string, Record<string, string>>;
    localOnly?: boolean;
  }
>;

type BuiltInAppSkillId = keyof typeof BUILT_IN_APP_SKILLS;

export const AGENT_NATIVE_SKILL_METADATA_FILE = "agent-native-skill.json";

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

type SkillsCommand = "list" | "add" | "status" | "update" | "help";

export interface ParsedSkillsArgs {
  command: SkillsCommand;
  target?: string;
  client: string;
  clientExplicit: boolean;
  clients?: ClientId[];
  plainSkillNames?: string[];
  scope: string;
  scopeExplicit: boolean;
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
  /**
   * Set once the PR Visual Recap workflow decision has already been made up
   * front (in `runSkills`, before any install/registration) so the per-target
   * `addAgentNativeSkill` doesn't prompt for it again mid-flow. The chosen
   * value lands in `withGithubAction`.
   */
  githubActionResolved?: boolean;
  /**
   * Plain skill repos can add a managed AGENTS.md / CLAUDE.md block for skills
   * that only become automatic through project instructions.
   */
  updateInstructions?: boolean;
  /**
   * When `--with-github-action` is set and the existing workflow file differs
   * from the bundled template, overwrite it. Without this flag the command
   * refuses and prints a message.
   */
  force?: boolean;
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
   * The exact `npx @agent-native/core@latest connect <url>` command to run when interactive auth
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
  githubActionSuggestedCommand?: string;
}

interface SkillInstallMetadata {
  schemaVersion: 1;
  source: "agent-native";
  appSkillId: string;
  displayName: string;
  skillName: string;
  contentHash: string;
  mcpUrl: string;
  installedAt: string;
  updateCommand: string;
}

interface SkillFolderBundle {
  appSkillId: BuiltInAppSkillId;
  displayName: string;
  skillName: string;
  mcpUrl: string;
  files: Record<string, string>;
  contentHash: string;
}

interface SkillInstallState {
  appSkillId: BuiltInAppSkillId;
  displayName: string;
  skillName: string;
  path: string;
  root: string;
  scope: "project" | "user";
  client: string;
  latestHash: string;
  installedHash: string | null;
  metadataHash?: string;
  current: boolean;
  managed: boolean;
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
  promptGithubAction?: (
    context: SkillsGithubActionPromptContext,
  ) => Promise<boolean | null>;
  promptScope?: (
    context: SkillsScopePromptContext,
  ) => Promise<"project" | "user" | null>;
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
  /**
   * Best-effort install-funnel telemetry. Created once per `runSkills` run and
   * threaded through resolution/install/connect so each `track` is fire-and-
   * forget and never blocks or throws into the install flow. Absent when
   * `addAgentNativeSkill` is called directly (e.g. tests).
   */
  telemetry?: CliTelemetry;
}

interface SkillsClientPromptContext {
  initialClients: ClientId[];
  options: Array<{ value: ClientId; label: string; hint: string }>;
}

interface SkillsTargetPromptContext {
  initialTargets: string[];
  options: Array<{ value: string; label: string; hint: string }>;
}

interface SkillsGithubActionPromptContext {
  workflowPath: string;
  setupCommand: string;
}

interface SkillsScopePromptContext {
  initialScope: "project" | "user";
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

/**
 * Sibling reference files for a skill (skill name -> relative path -> content),
 * materialized alongside its SKILL.md for progressive disclosure.
 */
function builtInExtraFiles(
  entry: (typeof BUILT_IN_APP_SKILLS)[BuiltInAppSkillId],
): Record<string, Record<string, string>> {
  return "extraFiles" in entry && entry.extraFiles ? entry.extraFiles : {};
}

function builtInSkillNames(
  entry: (typeof BUILT_IN_APP_SKILLS)[BuiltInAppSkillId],
): string[] {
  return [entry.skillName, ...Object.keys(builtInExtraSkills(entry))];
}

/**
 * When a target names a single skill that lives inside a multi-skill bundle
 * (the plan bundle ships both `visual-plan` and `visual-recap`), restrict the
 * install to just that skill. The bundle aliases (`visual-plans`, `plannotate`,
 * …) return undefined so they install every skill in the bundle.
 */
function builtInOnlySkillNames(target: string): string[] | undefined {
  const normalized = target.trim().toLowerCase();
  if (normalized === "visual-plan") return ["visual-plan"];
  if (normalized === "visual-recap" || normalized === "visual-recaps") {
    return ["visual-recap"];
  }
  return undefined;
}

function stableSkillHash(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const rel of Object.keys(files).sort()) {
    if (rel === AGENT_NATIVE_SKILL_METADATA_FILE) continue;
    hash.update(rel);
    hash.update("\0");
    hash.update(files[rel]);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

function skillFilesForBuiltIn(
  appSkillId: BuiltInAppSkillId,
): Record<string, SkillFolderBundle> {
  const entry = BUILT_IN_APP_SKILLS[appSkillId];
  const skills: Record<string, string> = {
    [entry.skillName]: entry.skillMarkdown,
    ...builtInExtraSkills(entry),
  };
  const extraFiles = builtInExtraFiles(entry);
  const out: Record<string, SkillFolderBundle> = {};
  for (const [skillName, skillMarkdown] of Object.entries(skills)) {
    const files = {
      "SKILL.md": skillMarkdown,
      ...(extraFiles[skillName] ?? {}),
    };
    out[skillName] = {
      appSkillId,
      displayName: entry.manifest.displayName,
      skillName,
      mcpUrl: isLocalOnlyBuiltInSkill(entry)
        ? ""
        : entry.manifest.hosted.mcpUrl,
      files,
      contentHash: stableSkillHash(files),
    };
  }
  return out;
}

function latestSkillBundlesForTargets(
  appSkillIds: BuiltInAppSkillId[],
): Record<string, SkillFolderBundle> {
  const out: Record<string, SkillFolderBundle> = {};
  for (const appSkillId of appSkillIds) {
    Object.assign(out, skillFilesForBuiltIn(appSkillId));
  }
  return out;
}

function writeSkillFolder(
  dir: string,
  bundle: SkillFolderBundle,
  installedAt = new Date().toISOString(),
): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(bundle.files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }
  const metadata: SkillInstallMetadata = {
    schemaVersion: 1,
    source: "agent-native",
    appSkillId: bundle.appSkillId,
    displayName: bundle.displayName,
    skillName: bundle.skillName,
    contentHash: bundle.contentHash,
    mcpUrl: bundle.mcpUrl,
    installedAt,
    updateCommand: `npx @agent-native/core@latest skills update ${bundle.skillName}`,
  };
  fs.writeFileSync(
    path.join(dir, AGENT_NATIVE_SKILL_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf-8",
  );
}

/**
 * The skills directory a built-in skill's instructions are copied into for a
 * given agent + scope. Mirrors the layout the skills installer uses so
 * `skills status` / `skills update` find the folders again.
 */
function builtInSkillsRootForAgent(
  agent: string,
  scope: "project" | "user",
  baseDir: string,
): string {
  const home = homeDir() ?? baseDir;
  if (scope === "project") {
    return agent === "codex"
      ? path.join(baseDir, ".agents", "skills")
      : path.join(baseDir, ".claude", "skills");
  }
  if (agent === "codex") {
    return process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, "skills")
      : path.join(home, ".codex", "skills");
  }
  return path.join(home, ".claude", "skills");
}

/**
 * Write a built-in skill's instruction folders straight into each client's
 * skills directory. Built-in skills ship their SKILL.md inside this package, so
 * there is no need to shell out to the separate @agent-native/skills installer
 * (which would have to be published to npm first). Returns the written folders.
 */
function installBuiltInInstructions(input: {
  appSkillId: BuiltInAppSkillId;
  onlySkillNames?: string[];
  skillsAgents: string[];
  scope: "project" | "user";
  baseDir: string;
  dryRun?: boolean;
}): string[] {
  const bundles = Object.values(skillFilesForBuiltIn(input.appSkillId)).filter(
    (bundle) =>
      !input.onlySkillNames || input.onlySkillNames.includes(bundle.skillName),
  );
  const written: string[] = [];
  for (const agent of input.skillsAgents) {
    const root = builtInSkillsRootForAgent(agent, input.scope, input.baseDir);
    for (const bundle of bundles) {
      const dir = path.join(root, bundle.skillName);
      if (!input.dryRun) writeSkillFolder(dir, bundle);
      written.push(dir);
    }
  }
  return written;
}

function listSkillFolderFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string, prefix = "") => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!entry.isFile() || rel === AGENT_NATIVE_SKILL_METADATA_FILE) continue;
      out[rel] = fs.readFileSync(abs, "utf-8");
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function readSkillInstallMetadata(
  dir: string,
): SkillInstallMetadata | undefined {
  const file = path.join(dir, AGENT_NATIVE_SKILL_METADATA_FILE);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (
      parsed &&
      parsed.source === "agent-native" &&
      typeof parsed.skillName === "string" &&
      typeof parsed.contentHash === "string"
    ) {
      return parsed as SkillInstallMetadata;
    }
  } catch {}
  return undefined;
}

function homeDir(): string | undefined {
  return process.env.HOME || os.homedir();
}

function skillSearchRoots(input: {
  baseDir: string;
  clients: ClientId[];
  scopes: Array<"project" | "user">;
}): Array<{
  root: string;
  scope: "project" | "user";
  client: string;
}> {
  const roots: Array<{
    root: string;
    scope: "project" | "user";
    client: string;
  }> = [];
  const clientSet = new Set(input.clients);
  const includeAll = input.clients.length === 0;
  const hasClient = (client: ClientId) => includeAll || clientSet.has(client);
  const add = (
    root: string | undefined,
    scope: "project" | "user",
    client: string,
  ) => {
    if (root) roots.push({ root, scope, client });
  };

  if (input.scopes.includes("project")) {
    if (hasClient("codex")) {
      add(path.join(input.baseDir, ".agents", "skills"), "project", "codex");
    }
    if (hasClient("claude-code") || hasClient("claude-code-cli")) {
      add(
        path.join(input.baseDir, ".claude", "skills"),
        "project",
        "claude-code",
      );
    }
    if (includeAll) add(path.join(input.baseDir, "skills"), "project", "repo");
  }

  if (input.scopes.includes("user")) {
    const home = homeDir();
    if (hasClient("codex")) {
      add(
        process.env.CODEX_HOME
          ? path.join(process.env.CODEX_HOME, "skills")
          : undefined,
        "user",
        "codex",
      );
      add(
        home ? path.join(home, ".codex", "skills") : undefined,
        "user",
        "codex",
      );
    }
    if (hasClient("claude-code") || hasClient("claude-code-cli")) {
      add(
        home ? path.join(home, ".claude", "skills") : undefined,
        "user",
        "claude-code",
      );
    }
  }

  const seen = new Set<string>();
  return roots.filter((entry) => {
    const key = `${entry.scope}:${entry.client}:${path.resolve(entry.root)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetIdsForStatus(parsed: ParsedSkillsArgs): BuiltInAppSkillId[] {
  if (!parsed.target) {
    return (Object.keys(BUILT_IN_APP_SKILLS) as BuiltInAppSkillId[]).filter(
      (id) => !isLocalOnlyBuiltInSkill(BUILT_IN_APP_SKILLS[id]),
    );
  }
  const known = normalizeKnownSkillTarget(parsed.target);
  if (!known) {
    throw new Error(
      `Unknown built-in skill: ${parsed.target}. Run "npx @agent-native/core@latest skills list".`,
    );
  }
  if (isLocalOnlyBuiltInSkill(BUILT_IN_APP_SKILLS[known])) {
    throw new Error(
      `${BUILT_IN_APP_SKILLS[known].manifest.displayName} is installed as a local command and cannot be refreshed with skills update yet.`,
    );
  }
  return [known];
}

function scopeFilterForStatus(
  parsed: ParsedSkillsArgs,
): Array<"project" | "user"> {
  return parsed.scopeExplicit
    ? [parsed.scope as "project" | "user"]
    : ["project", "user"];
}

function clientFilterForStatus(parsed: ParsedSkillsArgs): ClientId[] {
  return parsed.clientExplicit ? resolveClients(parsed.client) : [];
}

function collectSkillInstallStates(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): SkillInstallState[] {
  const appSkillIds = targetIdsForStatus(parsed);
  const latest = latestSkillBundlesForTargets(appSkillIds);
  const roots = skillSearchRoots({
    baseDir: options.baseDir ?? process.cwd(),
    clients: clientFilterForStatus(parsed),
    scopes: scopeFilterForStatus(parsed),
  });
  const states: SkillInstallState[] = [];
  const seenDirs = new Set<string>();

  for (const root of roots) {
    for (const bundle of Object.values(latest)) {
      const dir = path.join(root.root, bundle.skillName);
      const resolvedDir = path.resolve(dir);
      if (seenDirs.has(resolvedDir) || !fs.existsSync(dir)) continue;
      if (!fs.existsSync(path.join(dir, "SKILL.md"))) continue;
      seenDirs.add(resolvedDir);
      const files = listSkillFolderFiles(dir);
      const installedHash =
        Object.keys(files).length > 0 ? stableSkillHash(files) : null;
      const metadata = readSkillInstallMetadata(dir);
      states.push({
        appSkillId: bundle.appSkillId,
        displayName: bundle.displayName,
        skillName: bundle.skillName,
        path: dir,
        root: root.root,
        scope: root.scope,
        client: root.client,
        latestHash: bundle.contentHash,
        installedHash,
        metadataHash: metadata?.contentHash,
        current: installedHash === bundle.contentHash,
        managed: metadata?.source === "agent-native",
      });
    }
  }

  return states.sort((a, b) =>
    `${a.skillName}:${a.path}`.localeCompare(`${b.skillName}:${b.path}`),
  );
}

function updateSkillInstallStates(
  states: SkillInstallState[],
  dryRun: boolean,
): SkillInstallState[] {
  const latest = latestSkillBundlesForTargets([
    ...new Set(states.map((state) => state.appSkillId)),
  ]);
  const updated: SkillInstallState[] = [];
  for (const state of states) {
    if (state.current && state.managed) continue;
    const bundle = latest[state.skillName];
    if (!bundle) continue;
    if (!dryRun) writeSkillFolder(state.path, bundle);
    updated.push({
      ...state,
      current: !dryRun,
      installedHash: dryRun ? state.installedHash : bundle.contentHash,
      metadataHash: dryRun ? state.metadataHash : bundle.contentHash,
    });
  }
  return updated;
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

// For now the interactive installer offers only the two plan skills, each as
// an independently selectable entry (uncheck one to install just the other).
// The other built-in skills stay installable via `agent-native skills add
// <name>` but are hidden from the default checklist. The values are the real
// slash-command names so users see exactly what they are installing.
const PLAN_SKILL_PROMPT_OPTIONS: SkillsTargetPromptContext["options"] = [
  {
    value: "visual-plan",
    label: "visual-plan",
    hint: "Rich interactive visual plan that turns ordinary text plans into diagrams, file maps, annotated code, questions, and UI/prototype review.",
  },
  {
    value: "visual-recap",
    label: "visual-recap",
    hint: "Interactive visual recap that maps PRs/diffs with diagrams, annotated diffs, API/schema summaries, and review notes.",
  },
];

function skillPromptOptions(): SkillsTargetPromptContext["options"] {
  return PLAN_SKILL_PROMPT_OPTIONS;
}

function prVisualRecapWorkflowPath(baseDir: string): string {
  return path.join(baseDir, ".github", "workflows", "pr-visual-recap.yml");
}

function prVisualRecapWorkflowDisplayPath(): string {
  return path.join(".github", "workflows", "pr-visual-recap.yml");
}

function prVisualRecapInstallCommand(): string {
  return "npx @agent-native/core@latest skills add visual-recap --with-github-action";
}

function prVisualRecapSetupCommand(): string {
  return "npx @agent-native/core@latest recap setup";
}

async function promptForGithubAction(
  context: SkillsGithubActionPromptContext,
): Promise<boolean | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.confirm({
    message:
      "Optional: add automatic PR Visual Recaps? (GitHub Action)\n" +
      "  Posts a human-friendly recap on every pull request — a high-altitude\n" +
      "  overview of what the PR does, with annotated code, diagrams, and\n" +
      "  before/after notes instead of a raw diff.\n" +
      `  Writes ${context.workflowPath}; ${context.setupCommand} finishes the GitHub secrets.`,
    initialValue: false,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Skipped PR Visual Recap workflow.");
    return null;
  }
  return Boolean(result);
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

async function promptForScope(
  context: SkillsScopePromptContext,
): Promise<"project" | "user" | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.select({
    message: "Where do you want to install these skills?",
    options: [
      {
        value: "project",
        label: "Project",
        hint: "This repo only (.agents / .claude in the current directory) — committed with your project",
      },
      {
        value: "user",
        label: "User",
        hint: "Your home directory (~/.codex, ~/.claude) — available across all projects",
      },
    ],
    initialValue: context.initialScope,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return result === "project" ? "project" : "user";
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
  const initialClients = resolveClients("all");
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
  const promptOptions = skillPromptOptions();
  // The interactive multiselect skill picker is about to be shown (no --skill /
  // target passed and we are interactive) — record the funnel "prompted" step.
  options.telemetry?.track("skills_cli skills prompted", {
    availableCount: promptOptions.length,
    available: promptOptions.map((option) => option.value).join(","),
  });
  const selected = await prompt({
    initialTargets: ["visual-plan", "visual-recap"],
    options: promptOptions,
  });
  if (!selected || selected.length === 0) return null;
  // Both plan skills share one MCP connector, so when both are selected install
  // them through the bundle target — that registers/authenticates the connector
  // once instead of twice.
  const planSubskills = ["visual-plan", "visual-recap"];
  if (planSubskills.every((skill) => selected.includes(skill))) {
    return [
      "visual-plans",
      ...selected.filter((s) => !planSubskills.includes(s)),
    ];
  }
  return selected;
}

export function parseSkillsArgs(argv: string[]): ParsedSkillsArgs {
  const first = argv[0];
  let command: SkillsCommand = "list";
  let args = argv;
  if (first === "help" || first === "--help" || first === "-h") {
    command = "help";
    args = argv.slice(1);
  } else if (
    first === "list" ||
    first === "add" ||
    first === "status" ||
    first === "update"
  ) {
    command = first;
    args = argv.slice(1);
  } else if (first) {
    command = "add";
  }

  const out: ParsedSkillsArgs = {
    command,
    client: "all",
    clientExplicit: false,
    scope: "user",
    scopeExplicit: false,
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
    } else if ((value = eat("--skill")) !== undefined) {
      out.plainSkillNames = [...(out.plainSkillNames ?? []), value];
    } else if ((value = eat("-s")) !== undefined) {
      out.plainSkillNames = [...(out.plainSkillNames ?? []), value];
    } else if ((value = eat("--scope")) !== undefined) {
      out.scope = value;
      out.scopeExplicit = true;
    } else if ((value = eat("--mcp-url")) !== undefined) out.mcpUrl = value;
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
    else if (arg === "--update-instructions") out.updateInstructions = true;
    else if (arg === "--no-update-instructions") out.updateInstructions = false;
    else if (arg === "--force") out.force = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!out.target) out.target = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (out.scope !== "user" && out.scope !== "project") {
    throw new Error("--scope must be either user or project.");
  }
  return out;
}

function loadSkillTarget(
  target: string,
  onlySkillNames?: string[],
): SkillInstallTarget {
  const knownTarget = normalizeKnownSkillTarget(target);
  if (knownTarget) {
    const builtIn = BUILT_IN_APP_SKILLS[knownTarget];
    const skillNames = builtInSkillNames(builtIn).filter(
      (name) => !onlySkillNames || onlySkillNames.includes(name),
    );
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
        const bundles = skillFilesForBuiltIn(knownTarget);
        for (const bundle of Object.values(bundles)) {
          if (onlySkillNames && !onlySkillNames.includes(bundle.skillName)) {
            continue;
          }
          writeSkillFolder(
            path.join(outDir, "skills", bundle.skillName),
            bundle,
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
    "@agent-native/core@latest",
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
  if (parsed.withGithubAction) args.push("--with-github-action");
  if (parsed.updateInstructions === true) args.push("--update-instructions");
  if (parsed.updateInstructions === false)
    args.push("--no-update-instructions");
  if (parsed.yes || isKnownSkill(target)) args.push("--yes");
  return commandString("npx", args);
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

function isPlainSkillRepoPath(target: string): boolean {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return false;
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) return false;
  const hasDirectSkill = fs.existsSync(path.join(resolved, "SKILL.md"));
  const skillsDir = path.join(resolved, "skills");
  const hasSkillsDir =
    fs.existsSync(skillsDir) &&
    fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .some(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(skillsDir, entry.name, "SKILL.md")),
      );
  const hasAppSkillManifest = fs.existsSync(
    path.join(resolved, "agent-native.app-skill.json"),
  );
  return !hasAppSkillManifest && (hasDirectSkill || hasSkillsDir);
}

function isGithubSkillRepoTarget(target: string): boolean {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.+)?$/.test(target)) {
    return true;
  }
  try {
    const url = new URL(target);
    return url.hostname === "github.com";
  } catch {
    return false;
  }
}

function isPlainSkillRepoTarget(target: string): boolean {
  return isPlainSkillRepoPath(target) || isGithubSkillRepoTarget(target);
}

function agentNativeSkillsInstallArgs(
  parsed: ParsedSkillsArgs,
  target: string,
  clients: ClientId[],
): string[] {
  const args = [
    "--yes",
    "@agent-native/skills@latest",
    "add",
    target,
    "--client",
    clientArgForClients(clients),
    "--scope",
    parsed.scope,
  ];
  if (parsed.withGithubAction) args.push("--with-github-action");
  if (parsed.force) args.push("--force");
  if (!parsed.connect) args.push("--no-connect");
  for (const skill of parsed.plainSkillNames ?? []) {
    args.push("--skill", skill);
  }
  if (parsed.updateInstructions === true) args.push("--update-instructions");
  if (parsed.updateInstructions === false)
    args.push("--no-update-instructions");
  if (parsed.yes) args.push("--yes");
  return args;
}

async function addPlainSkillRepo(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): Promise<SkillsAddResult> {
  const target = parsed.target!;
  if (!parsed.instructions && parsed.mcp) {
    throw new Error(
      "Plain skill repositories only install skill instructions. Run without --mcp-only.",
    );
  }
  if (parsed.mcpUrl) {
    throw new Error(
      "--mcp-url only applies to app-backed Agent Native skills.",
    );
  }

  const clients = parsed.clients ?? resolveClients(parsed.client);
  const skillsAgents = skillsAgentsForClients(clients);
  if (skillsAgents.length === 0) {
    throw new Error(
      "Plain skill repositories can only install instructions for Codex or Claude Code clients.",
    );
  }
  const args = agentNativeSkillsInstallArgs(parsed, target, clients);
  if (!parsed.dryRun) {
    const code = await (options.runCommand ?? runCommand)("npx", args, {
      stdio: parsed.yes ? "silent" : "inherit",
    });
    if (code !== 0)
      throw new Error(
        `npx @agent-native/skills@latest add exited with ${code}.`,
      );
  }
  options.telemetry?.track("skills_cli install completed", {
    skills: target,
    clients: clients.join(","),
    scope: parsed.scope,
    dryRun: Boolean(parsed.dryRun),
  });
  return {
    id: target,
    displayName: target,
    skillNames: [],
    skillsAgents,
    mcpUrl: "",
    mcpClients: [],
    dryRun: parsed.dryRun,
    commands: [commandString("npx", args)],
    local: true,
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

/** Build the `npx @agent-native/core@latest connect <url> --client … --scope …` command. */
function connectCommandFor(
  hostedUrl: string,
  clients: ClientId[],
  scope: string,
): string {
  const args = [
    "@agent-native/core@latest",
    "connect",
    hostedUrl,
    "--client",
    clientArgForClients(clients),
    "--scope",
    scope,
  ];
  return commandString("npx", args);
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
  options.telemetry?.track("skills_cli connect started");
  try {
    await (options.runConnect ?? runConnect)([
      hostedUrl,
      "--client",
      clientArgForClients(clients),
      "--scope",
      parsed.scope,
    ]);
    options.telemetry?.track("skills_cli connect completed");
    return { connected: true, connectCommand: "" };
  } catch (err: any) {
    // Non-fatal: the MCP connector is registered. Surface the manual command.
    options.telemetry?.track("skills_cli connect failed", {
      error: err?.message ?? String(err),
    });
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
  // For multi-skill bundles (the plan bundle), a single-skill target installs
  // only that skill. `installsRecap` controls the PR Visual Recap github-action
  // offer, which is only relevant when the recap skill is part of the install.
  const onlySkillNames = knownTarget
    ? builtInOnlySkillNames(target)
    : undefined;
  const installsRecap =
    knownTarget === "visual-plans" &&
    (!onlySkillNames || onlySkillNames.includes("visual-recap"));
  if (!knownTarget && isPlainSkillRepoTarget(target)) {
    return addPlainSkillRepo({ ...parsed, target }, options);
  }
  if (!knownTarget && !fs.existsSync(path.resolve(target))) {
    throw new Error(
      `Unknown skill or manifest path: ${target}. Run "npx @agent-native/core@latest skills list".`,
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
      const githubActionPath =
        parsed.withGithubAction && knownTarget === "visual-plans"
          ? prVisualRecapWorkflowDisplayPath()
          : undefined;
      options.telemetry?.track("skills_cli install completed", {
        skills: knownBuiltIn.skillName,
        clients: clients.join(","),
        scope: parsed.scope,
        dryRun: true,
      });
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
        githubActionPath,
      };
    }
    const localInstall = installLocalContextXray({
      baseDir: options.baseDir ?? process.cwd(),
      clients,
      scope: parsed.scope,
    });
    options.telemetry?.track("skills_cli install completed", {
      skills: knownBuiltIn.skillName,
      clients: clients.join(","),
      scope: parsed.scope,
      dryRun: false,
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
  let installTarget = loadSkillTarget(target, onlySkillNames);
  if (parsed.mcpUrl) {
    installTarget = withMcpUrlOverride(installTarget, parsed.mcpUrl);
  }
  const clients = parsed.clients ?? resolveClients(parsed.client);
  installTarget = preserveMcpUrlAppPathOverride(installTarget, parsed.mcpUrl);
  const skillsAgents = skillsAgentsForClients(clients);
  if (parsed.dryRun) {
    try {
      const githubActionPath =
        parsed.withGithubAction && installsRecap
          ? prVisualRecapWorkflowDisplayPath()
          : undefined;
      const githubActionSuggestedCommand =
        installsRecap && !parsed.withGithubAction
          ? prVisualRecapInstallCommand()
          : undefined;
      options.telemetry?.track("skills_cli install completed", {
        skills: installTarget.skillNames.join(","),
        clients: clients.join(","),
        scope: parsed.scope,
        dryRun: true,
      });
      return {
        id: installTarget.id,
        displayName: installTarget.displayName,
        skillNames: installTarget.skillNames,
        skillsAgents,
        mcpUrl: installTarget.loaded.manifest.hosted.mcpUrl,
        mcpClients: clients,
        dryRun: true,
        commands: [dryRunInstallCommand(parsed, target)],
        githubActionPath,
        githubActionSuggestedCommand,
      };
    } finally {
      installTarget.cleanup?.();
    }
  }
  const commands: string[] = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-add-"));
  let instructionSource: string | undefined;
  let instructionsWritten: string[] | undefined;
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
      } else if (knownTarget) {
        // Built-in skills ship their instructions inside this package, so copy
        // the skill folders straight into each client's skills directory. This
        // avoids shelling out to the separate @agent-native/skills installer
        // (which would need to be published to npm to run via npx).
        instructionsWritten = installBuiltInInstructions({
          appSkillId: knownTarget,
          onlySkillNames,
          skillsAgents,
          scope: parsed.scope as "project" | "user",
          baseDir: options.baseDir ?? process.cwd(),
          dryRun: parsed.dryRun,
        });
        instructionSource = instructionsWritten[0];
        commands.push(...instructionsWritten.map((dir) => `write ${dir}`));
      } else {
        // External app-skill manifests / plain skill repos still go through the
        // standalone installer, which knows how to pack adapters and fetch
        // remote skill collections.
        instructionSource = installTarget.materializeInstructions(tmpRoot);
        const args = [
          "--yes",
          "@agent-native/skills@latest",
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
            throw new Error(
              `npx @agent-native/skills@latest add exited with ${code}.`,
            );
        }
      }
    }

    // Skill instructions are now on disk (built-in folders copied or external
    // pack materialized) — record the install before MCP registration/connect.
    options.telemetry?.track("skills_cli install completed", {
      skills: installTarget.skillNames.join(","),
      clients: clients.join(","),
      scope: parsed.scope,
      dryRun: Boolean(parsed.dryRun),
    });

    if (parsed.mcp) {
      commands.push(
        `npx @agent-native/core@latest app-skill ensure --manifest ${installTarget.loaded.file} --client ${parsed.client} --scope ${parsed.scope} --yes`,
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
        options.telemetry?.track("skills_cli mcp registered", {
          skills: installTarget.skillNames.join(","),
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
    const baseDir = options.baseDir ?? process.cwd();
    let withGithubAction = Boolean(parsed.withGithubAction);
    let githubActionPath: string | undefined;
    let githubActionExisted: boolean | undefined;
    let githubActionSuggestedCommand: string | undefined;
    if (
      installsRecap &&
      !withGithubAction &&
      !fs.existsSync(prVisualRecapWorkflowPath(baseDir))
    ) {
      // Normally the recap decision is made up front in `runSkills` (so it's
      // resolved here). Only prompt inline when a direct caller invoked
      // addAgentNativeSkill without going through that up-front step.
      if (!parsed.githubActionResolved && shouldPrompt(parsed, options)) {
        const prompt = options.promptGithubAction ?? promptForGithubAction;
        const choice = await prompt({
          workflowPath: prVisualRecapWorkflowDisplayPath(),
          setupCommand: prVisualRecapSetupCommand(),
        });
        if (choice === null) {
          options.telemetry?.track("skills_cli cancelled", {
            step: "github-action",
          });
        }
        withGithubAction = choice === true;
      }
      if (!withGithubAction) {
        githubActionSuggestedCommand = prVisualRecapInstallCommand();
      }
    }

    if (withGithubAction) {
      if (!installsRecap) {
        options.log?.(
          "--with-github-action only applies to the visual-recap skill; skipping the workflow.",
        );
      } else {
        const writeResult = writePrVisualRecapWorkflow(baseDir, {
          force: Boolean(parsed.force),
        });
        if (writeResult.status === "refused") {
          throw new Error(`recap workflow: ${writeResult.message}`);
        }
        githubActionPath = writeResult.path;
        githubActionExisted =
          writeResult.status === "written" ? writeResult.existed : false;
        commands.push(`write ${writeResult.path}`);
        options.telemetry?.track("skills_cli github action added");
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
      written: instructionsWritten,
      connected,
      connectCommand,
      githubActionPath,
      githubActionExisted,
      githubActionSuggestedCommand,
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

function skillStateJson(state: SkillInstallState) {
  return {
    appSkillId: state.appSkillId,
    displayName: state.displayName,
    skillName: state.skillName,
    path: state.path,
    scope: state.scope,
    client: state.client,
    status: state.current ? "current" : "stale",
    managed: state.managed,
    installedHash: state.installedHash,
    latestHash: state.latestHash,
    metadataHash: state.metadataHash,
  };
}

function formatSkillState(state: SkillInstallState): string {
  const status = state.current ? "current" : "stale";
  const managed = state.managed ? "managed" : "unmarked";
  const hashes =
    state.installedHash && !state.current
      ? ` (${state.installedHash} -> ${state.latestHash})`
      : "";
  return `${state.skillName.padEnd(22)} ${status.padEnd(7)} ${state.scope}/${state.client} ${managed}${hashes}\n  ${state.path}`;
}

function runSkillsStatusOrUpdate(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
  update: boolean,
): void {
  const before = collectSkillInstallStates(parsed, options);
  const changed = update ? updateSkillInstallStates(before, parsed.dryRun) : [];
  const after =
    update && !parsed.dryRun
      ? collectSkillInstallStates(parsed, options)
      : before;

  if (parsed.printJson) {
    const outputStates = update && !parsed.dryRun ? after : before;
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          command: parsed.command,
          dryRun: parsed.dryRun,
          found: before.length,
          stale: outputStates.filter((state) => !state.current).length,
          updated: changed.length,
          skills: outputStates.map(skillStateJson),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (before.length === 0) {
    const target = parsed.target ? ` for ${parsed.target}` : "";
    process.stdout.write(
      `No installed Agent Native skill copies found${target}.\nRun "npx @agent-native/core@latest skills add ${parsed.target ?? "visual-plan"}" to install one.\n`,
    );
    return;
  }

  if (update) {
    if (parsed.dryRun) {
      process.stdout.write(
        changed.length
          ? `Would update ${changed.length} skill folder${changed.length === 1 ? "" : "s"}:\n`
          : "All discovered skill folders are already current.\n",
      );
    } else {
      process.stdout.write(
        changed.length
          ? `Updated ${changed.length} skill folder${changed.length === 1 ? "" : "s"}.\n`
          : "All discovered skill folders are already current.\n",
      );
    }
  }

  const rows = (update && parsed.dryRun ? before : after).map(formatSkillState);
  process.stdout.write(`${rows.join("\n")}\n`);
}

/**
 * Resolve the CLI version the same way `index.ts` does — read it from the
 * package.json two levels up from the compiled module (dist/cli/skills.js →
 * ../../package.json). Best-effort: falls back to "unknown".
 */
function readCliVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(here, "../../package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
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

  // `@agent-native/skills` now delegates its interactive install to this
  // function. For plain skill repos we still shell out to
  // `npx @agent-native/skills@latest add …`; this env guard tells that child process
  // to run its OWN headless installer instead of bouncing back into core,
  // which would otherwise be an infinite skills → core → skills loop.
  process.env.AGENT_NATIVE_SKILLS_DIRECT = "1";

  // Best-effort install-funnel telemetry. Created once per run and flushed in a
  // finally so events send on success, error, and cancellation — the CLI is
  // short-lived, so flushing before exit is essential or the events never send.
  const startedAt = Date.now();
  const telemetry =
    options.telemetry ??
    createCliTelemetry({
      cli: "core",
      cliVersion: readCliVersion(),
      command: parsed.command,
      interactive: shouldPrompt(parsed, options),
    });
  const optionsWithTelemetry: RunSkillsOptions = { ...options, telemetry };

  try {
    telemetry.track("skills_cli started");

    if (parsed.command === "list") {
      const skills = listSkills();
      telemetry.track("skills_cli skills listed", {
        availableCount: skills.length,
        available: skills.map((skill) => skill.id).join(","),
      });
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

    if (parsed.command === "status" || parsed.command === "update") {
      runSkillsStatusOrUpdate(parsed, options, parsed.command === "update");
      return;
    }

    const targets = await resolveSkillTargets(parsed, optionsWithTelemetry);
    if (!targets) {
      telemetry.track("skills_cli cancelled", { step: "skills" });
      return;
    }
    const preselected = Boolean(parsed.target);
    telemetry.track("skills_cli skills selected", {
      selected: targets.join(","),
      selectedCount: targets.length,
      // Best-effort "took everything offered" signal: compare against the
      // interactive picker's option count (the plan sub-skills collapse into a
      // single bundle target, so this is approximate, like the standalone CLI).
      selectedAll: targets.length === skillPromptOptions().length,
      preselected,
    });

    const clients = await resolveSkillsClients(parsed, optionsWithTelemetry);
    if (!clients) {
      telemetry.track("skills_cli cancelled", { step: "clients" });
      return;
    }
    telemetry.track("skills_cli clients selected", {
      clients: clients.join(","),
      clientCount: clients.length,
    });

    // Ask where to install (project vs user) unless an explicit --scope was
    // passed or we are running non-interactively.
    if (!parsed.scopeExplicit && shouldPrompt(parsed, options)) {
      const promptScope = options.promptScope ?? promptForScope;
      const scope = await promptScope({ initialScope: "project" });
      if (!scope) {
        telemetry.track("skills_cli cancelled", { step: "scope" });
        return;
      }
      parsed.scope = scope;
    }
    telemetry.track("skills_cli scope selected", { scope: parsed.scope });

    // Decide the optional PR Visual Recap GitHub Action UP FRONT — before any
    // install or MCP registration — so every prompt is answered before we touch
    // disk. The choice is threaded into each install via `withGithubAction` +
    // `githubActionResolved` (so addAgentNativeSkill doesn't re-prompt mid-flow).
    const recapBaseDir = options.baseDir ?? process.cwd();
    const anyRecapTarget = targets.some((target) => {
      if (normalizeKnownSkillTarget(target) !== "visual-plans") return false;
      const only = builtInOnlySkillNames(target);
      return !only || only.includes("visual-recap");
    });
    if (
      anyRecapTarget &&
      !parsed.withGithubAction &&
      !fs.existsSync(prVisualRecapWorkflowPath(recapBaseDir)) &&
      shouldPrompt(parsed, options)
    ) {
      const prompt = options.promptGithubAction ?? promptForGithubAction;
      const choice = await prompt({
        workflowPath: prVisualRecapWorkflowDisplayPath(),
        setupCommand: prVisualRecapSetupCommand(),
      });
      if (choice === null) {
        telemetry.track("skills_cli cancelled", { step: "github-action" });
      }
      parsed.withGithubAction = choice === true;
      parsed.githubActionResolved = true;
    }

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
            ...optionsWithTelemetry,
            log,
          },
        ),
      );
    }

    // The add flow succeeded for every target — record the funnel completion
    // before printing output (output below cannot fail the install).
    const completedSkills = [
      ...new Set(results.flatMap((result) => result.skillNames)),
    ];
    const completedClients = [
      ...new Set(results.flatMap((result) => result.mcpClients)),
    ];
    telemetry.track("skills_cli completed", {
      skills: completedSkills.join(","),
      clients: completedClients.join(","),
      scope: parsed.scope,
      durationMs: Date.now() - startedAt,
    });

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

    const installedNames = results
      .map((result) => result.displayName)
      .join(", ");
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
      ? `PR Visual Recap workflow: wrote ${githubActions.join(", ")}.\nNext: run ${prVisualRecapSetupCommand()} to configure GitHub secrets/variables, or set them manually:\n  ${PR_VISUAL_RECAP_SETUP.join("\n  ")}`
      : "";
    const githubActionSuggestions = [
      ...new Set(
        results
          .map((result) => result.githubActionSuggestedCommand)
          .filter((command): command is string => Boolean(command)),
      ),
    ];
    const githubActionSuggestionLine = githubActionSuggestions.length
      ? `Optional PR Visual Recap workflow: run ${githubActionSuggestions.join(
          " && ",
        )} to add automatic recap comments on pull requests.`
      : "";
    const clack = await import("@clack/prompts");
    const summary = [
      skillsAgents.length
        ? `Skill instructions   ${skillsAgents.join(", ")}`
        : "Skill instructions   skipped",
      mcpClients.length
        ? `MCP config           ${mcpClients.join(", ")}`
        : "MCP config           not required",
      mcpUrls.length ? `MCP URL              ${mcpUrls.join(", ")}` : "",
      authConnected
        ? "Authentication       completed"
        : pendingConnectCommands.length
          ? `Authentication       pending — run ${pendingConnectCommands.join(" && ")}`
          : "",
      localCommands.length
        ? `Local command        ${localCommands.join(", ")}`
        : "",
    ].filter(Boolean);
    clack.note(
      summary.join("\n"),
      `Installed ${installedNames} skill${results.length === 1 ? "" : "s"}`,
    );

    // GitHub Action follow-ups — kept as exact, copy-pasteable command lines.
    for (const line of [githubActionLine, githubActionSuggestionLine].filter(
      Boolean,
    )) {
      process.stdout.write(`${line}\n`);
    }

    const slashCommands = completedSkills.map((name) => `/${name}`).join("  ");
    const configuredEveryClient = CLIENTS.every((client) =>
      clients.includes(client),
    );
    const clientHint = configuredEveryClient
      ? ""
      : "\n   Add another client later with --client <client> (e.g. --client claude-code).";
    clack.outro(
      `✅ All set! Start using ${slashCommands || "your new skills"} in your agent client.` +
        `\n   You may need to reload the client for the skill + MCP server to appear.` +
        clientHint,
    );
  } catch (error) {
    telemetry.track("skills_cli failed", {
      command: parsed.command,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    throw error;
  } finally {
    await telemetry.flush();
  }
}
