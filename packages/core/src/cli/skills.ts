/**
 * `agent-native skills` is the friendly install surface for app-backed skills.
 * The lower-level `app-skill` commands remain the packaging primitives; this
 * command handles the common "install Assets for my agent" path in one step.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import { setupAgentSymlinks } from "./setup-agents.js";
import { createCliTelemetry, type CliTelemetry } from "./telemetry.js";

const HELP = `npx @agent-native/core@latest skills

Usage:
  npx @agent-native/core@latest skills list
  npx @agent-native/core@latest skills status [assets|content|design-exploration|visual-plan|visual-recap|context-xray|scaffold] [--client codex|claude-code|pi|all] [--scope user|project] [--json]
  npx @agent-native/core@latest skills update [assets|content|design-exploration|visual-plan|visual-recap|context-xray|scaffold] [--client codex|claude-code|pi|all] [--scope user|project] [--dry-run] [--json]
  npx @agent-native/core@latest skills add assets|content|design-exploration|visual-plan|visual-recap|context-xray [--client codex|claude-code|cowork|cursor|opencode|github-copilot|all] [--scope user|project] [--mode hosted|local-files|self-hosted] [--mcp-url <url>] [--no-connect] [--with-github-action] [--yes] [--dry-run] [--json]
  npx @agent-native/core@latest skills add <manifest-or-app-dir|skill-repo> [--skill <name>] [--client ...] [--yes]

Examples:
  npx @agent-native/core@latest skills add assets
  npx @agent-native/core@latest skills add content --mode local-files
  npx @agent-native/core@latest skills add design-exploration
  npx @agent-native/core@latest skills add visual-plan
  npx @agent-native/core@latest skills add visual-recap
  npx @agent-native/core@latest skills add visual-recap --with-github-action
  npx @agent-native/core@latest skills add visual-plan --mode local-files
  npx @agent-native/core@latest skills add visual-plan --mode self-hosted --mcp-url https://my-plan-app.example.com
  npx @agent-native/core@latest skills status visual-plan
  npx @agent-native/core@latest skills update visual-plan
  npx @agent-native/core@latest skills update scaffold --project
  npx @agent-native/core@latest skills add visual-plan --no-connect
  npx @agent-native/core@latest skills add context-xray --client all
  npx @agent-native/core@latest skills add assets --client claude-code
  npx @agent-native/core@latest skills add assets --mcp-url https://my-app.ngrok-free.dev
  npx @agent-native/core@latest skills add ./dist/assets-skill --client codex
  npx @agent-native/core@latest skills add BuilderIO/skills --client codex --scope project
  npx @agent-native/core@latest skills add BuilderIO/skills --with-github-action

The add command installs the SKILL.md instructions, registers the app-backed
MCP connector, and then authenticates it in one step so you do not hit an OAuth
wall on the first tool call. Hosted installs can configure Claude Code, Codex,
Claude Cowork, Cursor, OpenCode, and GitHub Copilot / VS Code; local-files
instruction installs target the shared .agents skill path used by Codex, Pi,
Cursor, OpenCode, Copilot, and similar agents, plus Claude Code's native skill
path when selected. Pass --client to narrow it. Authentication reuses
"npx @agent-native/core@latest connect": OAuth-capable clients (Claude Code,
Cursor, OpenCode, GitHub Copilot / VS Code) get URL-only entries and authenticate
inside that host, while Codex / Cowork run the browser device-code flow. In a
non-interactive shell or CI the auth step is skipped and the exact
"npx @agent-native/core@latest connect <url> --client all" command is printed instead.

Running "npx @agent-native/skills@latest add ..." uses this same shared install
flow with the broader BuilderIO skills catalog enabled. Pass --no-connect to
register MCP where possible without authenticating (leave auth to the host or run
"npx @agent-native/core@latest connect" later). Pass --mcp-url to register that connector against
a custom origin (an ngrok tunnel, a local dev server, or a self-hosted
deployment) instead of the built-in hosted default — a bare origin gets the
standard /_agent-native/mcp path appended. Use app-skill pack for marketplace
bundles and custom adapter output.

When installing visual-plan or visual-recap interactively, the CLI asks where
plans and recaps should live: hosted Plans for shareable links/comments, local
files for "No sharing, all local.", or a self-hosted/custom Plan app URL.
Pass --mode to choose directly. Local-files mode skips MCP registration and
auth and installs instructions that default to a no-auth block catalog fetch,
MDX folders, and the localhost bridge viewer.

When installing content with --mode local-files, the CLI installs Content
instructions and writes or updates agent-native.json with repo-backed Markdown /
MDX roots for docs, blog, content, and resources. Use a local Content app, Agent
Native Desktop, or another trusted local bridge for Content actions to read and
write those files.

When installing visual-recap interactively, the CLI offers to add the optional PR
Visual Recap GitHub Action. Pass --with-github-action to write it directly, then
run "npx @agent-native/core@latest recap setup" / "npx @agent-native/core@latest recap doctor" to configure and
verify GitHub Actions. Docs: https://www.agent-native.com/docs/pr-visual-recap.

The status/update commands inspect copied Agent Native skill folders and refresh
their instruction files from the current @agent-native/core package. In generated
apps/workspaces, "skills update scaffold --project" refreshes the framework
skills copied into the scaffold and repairs AGENTS.md / CLAUDE.md and
.agents/skills / .claude/skills compatibility links.`;

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

const CONTENT_SKILL_MD = `---
name: content
description: >-
  Use Content for repo-backed Markdown/MDX docs, blogs, resources, rich
  document editing, local components, shareable copies, and Content local-file
  workspaces. Prefer Content actions over raw filesystem writes when available.
metadata:
  visibility: exported
---

# Content

Use the Content app when a workflow is about authoring, editing, reviewing, or
publishing Markdown/MDX documents: docs sites, blogs, resource libraries,
marketing pages, internal notes, and local MDX components. Content gives the
agent a document tree, a rich editor, normal document actions, and optional
local-file source of truth.

## Choose The Path

- Use Content actions when the Content MCP/action tools are available:
  \`list-documents\`, \`search-documents\`, \`get-document\`,
  \`pull-document\`, \`create-document\`, \`edit-document\`,
  \`update-document\`, \`delete-document\`, \`share-local-file-document\`,
  \`list-local-component-files\`, and \`write-local-component-file\`.
- Use \`pull-document\` or \`get-document\` before editing a page. Use
  \`edit-document\` for precise find/replace changes and \`update-document\`
  for full rewrites or new content.
- In Local File Mode, Content actions read and write the repo files declared in
  \`agent-native.json\`; SQL remains cache/history/search glue, not the source of
  truth for those pages.
- If Content tools are not visible and no local Content app or Desktop bridge is
  running, treat this skill as repo-editing guidance. Edit configured
  \`.md\`/\`.mdx\` files directly, preserve frontmatter and MDX imports, and tell
  the user the Content action surface was not available.

## Action Examples

Prefer JSON input for action calls:

\`\`\`bash
pnpm action list-documents
pnpm action get-document '{"id":"local-file:..."}'
pnpm action edit-document '{"id":"local-file:...","find":"old copy","replace":"new copy"}'
pnpm action update-document '{"id":"local-file:...","content":"# Updated\\n\\nBody"}'
pnpm action share-local-file-document '{"id":"local-file:..."}'
\`\`\`

Run \`refresh-list\` after create/update/delete operations when you need the
open Content UI sidebar to repaint immediately.

## Local File Mode

Install into an existing repo with:

\`\`\`bash
npx @agent-native/core@latest skills add content --mode local-files --scope project
\`\`\`

The installer copies this skill and writes or updates \`agent-native.json\` with
Content roots for \`docs/\`, \`blog/\`, \`content/\`, and \`resources/\`, plus a
\`components/\` folder for local MDX components. A typical manifest looks like:

\`\`\`json
{
  "version": 1,
  "apps": {
    "content": {
      "mode": "local-files",
      "roots": [
        { "name": "Docs", "path": "docs", "kind": "docs", "extensions": [".md", ".mdx"] },
        { "name": "Blog", "path": "blog", "kind": "blog", "extensions": [".md", ".mdx"] },
        { "name": "Content", "path": "content", "kind": "content", "extensions": [".md", ".mdx"] },
        { "name": "Resources", "path": "resources", "kind": "resources", "extensions": [".md", ".mdx"] }
      ],
      "components": "components",
      "extensions": "extensions",
      "hide": ["**/_*.md", "**/_*.mdx"]
    }
  }
}
\`\`\`

Local File Mode does not make the host language model local, and the hosted
Content app cannot read private repo files by itself. File access requires a
local Content app, Agent Native Desktop, or another trusted local bridge.

## MDX And Components

- Preserve frontmatter keys you do not understand. Preserve MDX imports,
  exports, JSX, and expression props unless the user explicitly asks to change
  them.
- Use local components from the configured \`components\` folder. Components
  should be PascalCase exports from \`.tsx\` files; simple editable input metadata
  can live next to them as \`ComponentNameInputs\`.
- Use \`list-local-component-files\` and \`write-local-component-file\` for
  component source changes when Content tools are available. Otherwise edit the
  component files directly like normal repo source.

## Boundaries

- Moving, renaming, and reordering local-file pages are not first-class Content
  UI operations yet. Use normal file operations when the user asks for those,
  then let Content rediscover the file tree.
- Do not push/pull Notion, Builder.io, or other provider-backed content unless
  the user explicitly asks for provider sync.
- Do not paste secrets, private provider data, or credential-looking values into
  docs, generated pages, frontmatter, examples, or local components.
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
npx @agent-native/core@latest skills add visual-plans
\`\`\`

After that, \`/visual-plan\` and \`/visual-recap\` are the two installed slash
commands. If you only need one command, use \`skills add visual-plan\` or
\`skills add visual-recap\` instead. The other planning modes
(\`create-ui-plan\`, \`create-prototype-plan\`, \`create-plan-design\`,
\`create-visual-questions\`) are MCP tools reachable from \`/visual-plan\`, not
separate slash commands. Pass \`--no-connect\` to register the connector without
authenticating, then run
\`npx @agent-native/core@latest connect https://plan.agent-native.com --client all\`
whenever you are ready, or choose a narrower \`--client\`. Auth and MCP tool
loading are per client config/session.

**Local-only / text installs.** If the user wants no sharing and all local files,
install with \`--mode local-files\`:

\`\`\`bash
npx @agent-native/core@latest skills add visual-plans --mode local-files
\`\`\`

This mode does not register the Plan MCP connector. Before authoring structured
MDX, fetch the no-auth, schema-only block catalog with
\`npx @agent-native/core@latest plan blocks --out plan-blocks.md\`, read that file,
write the MDX folder locally, run \`plan local check\`, then run \`plan local serve\`.
Plain text skill
installs (Vercel Skills CLI, copied GitHub files, etc.) can follow that same
local flow if \`@agent-native/core\` is available. Text alone cannot register
MCP tools; hosted/shareable Plans still need the Agent-Native CLI
install/reconnect step above.

**Browser (people you share with).** Open the Plans editor and create & edit
with no sign-up — you work as a guest. Sign in only when you want to save or
share; signing in claims the plans you made as a guest into your account.

Sharing and commenting require an account: public/shared plans are viewable by
anyone with the link, but commenting on them needs an agent-native account.

For no-account, no-DB plan storage, use local-files mode and the local bridge
command. The optional \`plan blocks\` lookup reads only public schema metadata.
If network access is unavailable, use the bundled references and a local Plan
app/runtime for validation.

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

**No decorative shadows around mockups.** Do not put \`box-shadow\`, \`filter:
drop-shadow(...)\`, Tailwind \`shadow-*\` classes, or other fake depth effects on a
wireframe frame, root container, \`.wf-card\` / \`.wf-box\`, or canvas artboard.
Mockups should read as flat, bordered surfaces; use spacing, borders, labels,
and annotations for separation. Only show a shadow when the real product UI
already has that shadow and it is essential to the change being reviewed.

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
(page background), \`--wf-card\` (container surface), \`--wf-accent\` /
\`--wf-accent-fg\` / \`--wf-accent-soft\` (brand action), \`--wf-warn\`, \`--wf-ok\`,
and \`--wf-radius\`. Never hard-code a hex color and never set \`font-family\` — the
renderer owns the sketch/clean font.

**Use literal CSS lengths for spacing.** The \`--wf-*\` tokens are for colors and
renderer-owned visual styling, not layout spacing. Do not use guessed spacing
tokens such as \`var(--wf-space-4)\`, Tailwind spacing classes, or theme spacing
variables inside wireframe HTML; if a token is unavailable in the Plan renderer,
padding collapses and content hugs the border. Use explicit CSS lengths for
layout: \`padding:16px\`, \`gap:12px\`, \`margin-top:18px\`, \`minmax(0,1fr)\`.

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

**Editing an existing mockup.** In hosted mode, to change one element, text, or
color in an existing html mockup, do not regenerate the frame — call
\`update-visual-plan\` with
\`contentPatches: [{ op: "patch-wireframe-html", blockId, edits: [{ find,
replace }] }]\`. Each \`find\` is a unique snippet of the current html (read it
first with \`get-visual-plan\`); set \`all: true\` on an edit to replace every
occurrence. The result is re-sanitized. In local-files privacy mode, do not call
hosted Plan tools; edit the local MDX source directly and rerun the local
check/serve or verify command for \`<plan-dir>\`.

**Treat the wireframe border as part of the visible design.** Always wrap HTML
wireframe content in a root container with real inner padding before drawing
cards, fields, pills, labels, or controls. Use at least 14-16px of padding,
\`box-sizing: border-box\`, \`height: 100%\`, and \`gap\` between child rows on the
root node itself so the first row never sits flush against the screen border. Do
not rely on padding on a nested page section as the first visible inset; the
outermost element must create the breathing room. Keep text away from borders:
every container, field, button, menu item, and annotation needs enough padding
and line-height to read cleanly in the rendered Plan view.

**For feature-cloud or abundance visuals, optimize the composition over line-by-line
reading.** Some marketing/product sections need to feel like a large surface area
of capability rather than a precise app workflow. In those cases, use one padded
root with a short headline and a dense, aesthetic cloud of short feature labels,
chips, rings, or columns. Vary scale and opacity with tokens, cluster by meaning,
and let many labels be glanceable rather than individually essential. Do not
force dozens of features into equal cards with long wrapped sentences; that
usually creates a messy unreadable mockup.

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
between rendered artboard rectangles plus room for annotation gutters; when a
broad browser/desktop frame sits beside a compact panel/popover, leave at least
160px so frame borders, labels, and hover controls never touch. Connect only
neighboring steps; never draw a long connector that skips across unrelated
frames. Connector labels must sit in open canvas space. If the label would touch
or cross either artboard, remove the label and explain the transition with a
nearby annotation instead. Before handoff, inspect the top canvas at default zoom
and move any frame whose label, connector, or annotation crosses another frame.

**Board-unit spacing defaults.** The canvas coordinate system uses approximately 2 board units per screen pixel. \`browser\` frames occupy roughly 700 × 600 board units; \`desktop\` frames roughly 900 × 700 board units. Apply these minimum x/y gaps when placing frames explicitly — any less and frames will touch or overlap:
- x-gap between \`browser\` frames: **≥ 1100** (700-unit frame + 400-unit gutter)
- x-gap between \`desktop\` frames: **≥ 1300** (900-unit frame + 400-unit gutter)
- y-gap between rows of any surface: **≥ 1400** (includes frame height + section header + buffer)

When in doubt, use larger values — the canvas auto-zooms to fit everything.

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

**Storyboards are canvas artifacts, not document diagrams.** When the requested
output is a product flow, onboarding journey, "light storyboard", or canvas
wireframe, author the flow as multiple top-canvas artboards with real screen
content and neighboring connectors. Keep document-body \`diagram\` blocks for
architecture and mechanics that are not themselves user-visible screens. A
storyboard made from a single inline HTML diagram is the wrong surface.

For abstract product concepts, use the canvas to create the first "I get it"
moment: one real app state near the top showing how the concept appears to a
user, followed by separate annotations or diagrams for mechanics. Do not make
the first artboard a hybrid of app UI and architecture notes; the app screen
should be inspectable as product UI on its own.

**Legacy kit tree.** Older plans set a \`screen\` array of \`{ el, ...props }\` kit
nodes instead of \`html\`; the renderer still accepts and displays it so saved
plans round-trip, but new plans emit \`html\`. Do not author fresh kit-tree
screens, and do not put nested kit components such as \`<FrameScreen>\`, \`<Card>\`,
\`<Row>\`, \`<Title>\`, or \`<Btn>\` inside a canvas \`<Screen>\`. A new canvas artboard
with kit-tree children is a defect: replace it with
\`<Screen surface="..." html={...} />\` using the HTML wireframe rules. The HTML
path is the one that gets the renderer-owned surface sizing, theme tokens,
sketch/clean toggle, and safe text layout used by good document-body
wireframes. Likewise, old or imported plans may carry coordinate-based regions
or free-float x/y on notes; those are legacy escape hatches the renderer still
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
  sequence. Do not use a body \`diagram\` as the primary artifact for a requested
  product canvas, light storyboard, UI flow, screen flow, or wireframe; those
  belong in the top canvas as artboards with \`Screen\` wireframes first. Use
  diagrams below that canvas only for architecture, data flow, or implementation
  mechanics. For architecture/code
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
When \`custom-html\` is genuinely needed, author it against the sandbox-provided
theme tokens (\`--wf-paper\`, \`--wf-card\`, \`--wf-ink\`, \`--wf-muted\`,
\`--wf-line\`, \`--wf-radius\`, and the matching \`--plan-*\` aliases). Do not hardcode
hex/rgb/hsl light palettes such as white cards with dark ink; the same fragment
must read in dark mode without a plan-specific patch.

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

Create or adapt a visual plan whenever the plan would be better as a reviewable
artifact than a chat paragraph. This includes modest work such as a single UI
surface with states, a small workflow, a before/after product change, or a
component/API/data-shape decision that needs alignment, plus larger multi-file,
ambiguous, long-running, risky, or UI-heavy work. Use it when architecture /
data flow / UI direction / options / open questions would benefit from inline
diagrams or structured blocks, when the user needs to react to a direction
before you implement, or when an existing text plan needs a richer review
surface.

## Plan Discipline

- **Gate thoughtfully.** A visual plan is a richer review surface, not only a
  tool for giant projects. Use it when the user needs to see, compare, comment
  on, or approve a direction before code, even for a modest UI/state/workflow
  change. Skip it for truly trivial, unambiguous work — typos, one-line fixes, a
  single well-specified function, anything whose diff you could describe in one
  sentence — and just make the change. Never pad a plan with filler and never
  ship a single-step plan.
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
  questions before finalizing. Do not call \`create-visual-questions\` for
  ordinary clarification or preflight; reserve it for the visual-intake mode when
  the user explicitly asks for a visual intake questionnaire. Otherwise state the
  assumption explicitly and proceed, and keep anything unresolved in the plan's
  single bottom \`question-form\` Open Questions block. For complex plans, do a
  final open-question pass before handoff: if a decision would affect
  architecture, scope, UX, data shape, or rollout, either decide it in the plan
  with rationale or put it in that bottom form with a recommended default.
- **The plan is the approval gate.** After surfacing it, ask the user to review
  and approve before you write code, and name which files/areas the work touches.
  Presenting the plan and requesting sign-off is the approval step — do not ask a
  separate "does this look good?" question.
- **The document is the source of truth, not the chat.** When scope shifts,
  update the plan with \`update-visual-plan\` rather than only changing course in
  chat, and make the updated document stand alone. Do not describe the update as
  a correction to an earlier draft inside the plan itself. Re-read the approved
  plan before major steps.

## Create A Structured Agent-Native Plan — Never Inline

The deliverable is ALWAYS a structured Agent-Native Plan, not a chat-only plan.
The hosted Plan MCP connector (\`plan\` server, or legacy \`agent-native-plans\`) is
the default collaboration and commenting surface; it is not a reason to reject
the planning pattern as an external dependency or rented layer. Plans are
portable source artifacts (\`plan.mdx\`, optional \`canvas.mdx\` /
\`prototype.mdx\`, JSON, and HTML export), and ownership-sensitive workflows can
use local-files mode or a self-hosted/custom Plan app URL without abandoning the
skill's review discipline. Do not advise the user to skip \`/visual-plan\` because
the default surface is hosted; choose the right Plan mode for the user's
ownership, privacy, sharing, and branding needs.

By default, create the plan via the Plan MCP connector. NEVER hand the plan over
as inline chat content — no Markdown prose, ASCII sketch, table, or fenced
wireframe. Some clients lazy-load connector tools through a deferred tool
registry instead of showing the \`plan\` namespace upfront; before declaring the
connector missing, search/load tools with the host's discovery surface
(\`tool_search\` when available) for \`create_visual_plan\`, \`create_ui_plan\`, or
\`get_plan_blocks\`, then use the Plan MCP tools it exposes. If the connector's
tools are still missing after discovery, do NOT fall back to inline output: the
usual cause is a connector that did not finish connecting this session (it
registers zero tools), not auth. Stop and give the user the exact restore step
for their current client: in Codex/Codex Desktop run
\`npx -y @agent-native/core@latest reconnect https://plan.agent-native.com --client codex\`
and start a new Codex session; in Claude Code run \`/mcp\` and choose
Authenticate/Reconnect (or run the same reconnect command with
\`--client claude-code\` and restart Claude). Auth is stored per client
config/session, so one client's reconnect does not make another running client
load tools. Never reinstall from scratch just to fix auth. Publish once the tool
is reachable. Local-files privacy mode (after Tool Guidance) is the exception.

## Core Workflow

This section describes the default hosted Plan MCP workflow. If
\`AGENT_NATIVE_PLANS_MODE=local-files\` is set, or the user asks for fully local
files/no hosted Plan writes, use **Local-Files Privacy Mode** instead; carry
forward only the code-research and plan-composition guidance here.

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
   Wide document layout is renderer-owned and intentionally allowlisted: only
   literal code-review surfaces (\`diff\`, \`annotated-code\`) and \`tabs\` blocks
   with vertical orientation or diff-like children break out wider than prose.
   Keep \`api-endpoint\`, \`openapi-spec\`, \`data-model\`, \`json-explorer\`,
   \`wireframe\`, question, and \`custom-html\` blocks in normal document flow unless
   their own renderer says otherwise.
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
5. For hosted plans, call \`get-plan-feedback\` before editing, after review,
   after any long pause,
   and before the final response. Treat \`anchorDetails\`, resolver intent, recent
   review events, and any focused screenshots from browser handoff as the source
   of truth for exactly what changed and exactly what each comment points at.
6. For hosted plans, apply changes with \`update-visual-plan\`, preferring
   targeted \`contentPatches\`.
   Treat the top-level \`content\` payload as a full replacement, not a merge; do
   not send a partial \`content\` object to add a canvas or one block. If a full
   replacement is unavoidable, first read the complete plan source/content, carry
   forward every existing block and visual surface, and verify the source/export
   afterward so the document body was not truncated. When the user wants
   source-control friendly edits, use \`patch-visual-plan-source\` against the MDX
   files instead of regenerating the plan.
7. For hosted plans, export with \`export-visual-plan\` only when the user wants a
   shareable receipt or repo-check-in artifacts.

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

When the user asks for a flow, storyboard, journey, wireframe, canvas, or "what
this looks like", treat that as a canvas-first request. Make one artboard per
user-visible state, connect only adjacent transitions, and use short canvas
annotations for the product notes. Do not substitute a document-body \`diagram\`
block for the requested storyboard just because HTML diagrams are faster to
write; diagrams belong below the canvas for backend mechanics, architecture, or
data-flow explanation.

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
Canvas artboards use the same HTML wireframe path as document-body
\`WireframeBlock\` screens: author \`<Screen surface="..." html={...} />\` with a
semantic HTML fragment. Do not author fresh kit-tree children such as
\`<FrameScreen>\`, \`<Card>\`, \`<Row>\`, or \`<Btn>\` inside canvas \`<Screen>\` tags;
those are legacy compatibility markup for old plans and produce brittle canvas
layouts.

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
no hosted Plan database writes, no Plan MCP publish, fully local files, offline/private
planning, repo-owned/source-controlled planning artifacts, or when
\`AGENT_NATIVE_PLANS_MODE=local-files\` is set. Also use it when a user or repo
policy says a plan must stay under their own brand, domain, source control, or
infrastructure. In this mode the plan data must never be sent to the Plan MCP
server or Plan app action surface. Schema-only block catalog lookup is allowed
because it sends no plan content: use the MCP \`get-plan-blocks\` tool if it is
already available, or run
\`npx @agent-native/core@latest plan blocks --out plan-blocks.md\` and read that
file before authoring MDX.

The local-files contract is:

- Read source context from local files and shell commands only.
- Fetch/read the block catalog before writing structured MDX. The
  \`plan blocks\` command calls the public no-auth \`get-plan-blocks\` route and
  writes only registry metadata to disk; use \`--format schema\` if exact nested
  fields are needed. If network access is unavailable, use the bundled
  references and rely on \`plan local check\` / \`plan local serve\` to catch
  invalid tags. For \`checklist\` and \`question-form\`, copy the catalog examples
  verbatim: checklist items need \`id\` and \`label\`; question-form questions need
  \`id\`, \`title\`, and \`mode\`; and each option needs \`id\` and \`label\`. \`plan local
  check\` validates these required fields against the renderer schema.
- Write the plan as a local MDX folder: use \`plans/<slug>/\` when the user
  wants the artifact checked into the repo, or use a repo-ignored/temporary
  folder such as \`.agent-native/plans/<slug>/\` or \`/tmp/agent-native-plans/<slug>/\`
  when it should not be checked in. The folder contains \`plan.mdx\`, optional
  \`canvas.mdx\`, optional \`prototype.mdx\`, and optional \`.plan-state.json\`. Use
  that exact chosen folder as \`<plan-dir>\` in every local CLI command below.
- Run \`npx @agent-native/core@latest plan local check --dir <plan-dir>\` before
  serving, then run
  \`npx @agent-native/core@latest plan local serve --dir <plan-dir> --kind plan --open\`.
  Report the returned local bridge URL from stdout or \`<plan-dir>/.plan-url\`.
  Treat \`.plan-url\` as a local token file and do not commit it. The URL opens
  the hosted Plan UI but reads from the localhost bridge on this machine, so it
  is not shareable across machines. On macOS, \`--open\` prefers Chromium browsers;
  if Safari opens, switch to Chrome/Chromium because Safari can block the hosted
  HTTPS page from fetching the HTTP localhost bridge. If the Plan app itself is
  running locally with the same \`PLAN_LOCAL_DIR\`, the \`/local-plans/<slug>\` route
  is also valid.
- For headless verification, run
  \`npx @agent-native/core@latest plan local verify --dir <plan-dir> --kind plan\`.
  It starts the bridge, checks the private-network preflight and JSON payload,
  prints diagnostics, and exits. If the browser hangs on "Loading plan", fetch
  the \`bridgeUrl\` from the verify/serve JSON to read the concrete validation
  error.
- Do **not** call \`create-visual-plan\`, \`create-ui-plan\`,
  \`create-prototype-plan\`, \`create-plan-design\`, \`import-visual-plan-source\`,
  \`update-visual-plan\`, \`patch-visual-plan-source\`, \`get-plan-feedback\`,
  \`export-visual-plan\`, or any hosted Plan tool for that plan except the
  schema-only block catalog lookup above.
- Treat feedback as file or chat feedback: update the MDX files directly, rerun
  the local bridge command, and summarize the new local bridge URL. Hosted
  comments, sharing, history, and publish/export receipts are unavailable until
  the user explicitly opts into publishing.

Local-files mode prevents plan content from going to the Agent-Native Plan
database. It does not by itself make the coding agent's language model local;
for that stronger privacy boundary, the host agent/model must also be local or
otherwise approved by the user.

## Interpreting comment anchors

This section applies to hosted plans with \`get-plan-feedback\` /
\`update-visual-plan\`. In local-files mode, do not call hosted feedback or update
tools; interpret file/chat feedback directly, edit the MDX files, rerun the
local bridge check/serve/verify command, and report the new local URL.

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
npx @agent-native/core@latest skills add visual-plans
\`\`\`

After that, \`/visual-plan\` and \`/visual-recap\` are the two installed slash
commands. If you only need one command, use \`skills add visual-plan\` or
\`skills add visual-recap\` instead. The other planning modes
(\`create-ui-plan\`, \`create-prototype-plan\`, \`create-plan-design\`,
\`create-visual-questions\`) are MCP tools reachable from \`/visual-plan\`, not
separate slash commands. Pass \`--no-connect\` to register the connector without
authenticating, then run
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
no hosted Plan database writes, no Plan MCP publish, fully local files, offline/private
recaps, or when \`AGENT_NATIVE_PLANS_MODE=local-files\` is set. This is the only
exception to the hosted publish rule below.

In local-files mode:

- Read the diff/stat/source context from local files and shell commands only.
  The existing \`npx @agent-native/core@latest recap collect-diff\`, \`scan\`, and
  \`build-prompt --local-files\` helpers are safe to use because they operate on
  local files and do not write to the Plan database.
- Fetch/read the block catalog before writing structured MDX. Use
  \`npx @agent-native/core@latest plan blocks --out plan-blocks.md\` when the Plan
  MCP connector is not registered; it calls the public no-auth
  \`get-plan-blocks\` route and sends no recap content. If network access is
  unavailable, use the bundled references and validate the MDX with
  \`plan local check\`; do not run \`plan local serve\` unless the hosted Plan UI is
  reachable or a local Plan app is already running. For \`checklist\` and \`question-form\`,
  copy the catalog examples verbatim: checklist items need \`id\` and \`label\`;
  question-form questions need \`id\`, \`title\`, and \`mode\`; and each option needs
  \`id\` and \`label\`. \`plan local check\` validates these required fields against
  the renderer schema.
- Write the recap as a local MDX folder: use \`plans/<slug>/\` when the user
  wants the artifact checked into the repo, or use a repo-ignored/temporary
  folder such as \`.agent-native/plans/<slug>/\` or \`/tmp/agent-native-plans/<slug>/\`
  when it should not be checked in. The folder contains \`plan.mdx\`, optional
  \`canvas.mdx\`, optional \`prototype.mdx\`, and optional \`.plan-state.json\`. Set
  \`kind: "recap"\` and \`localOnly: true\` in frontmatter/state when authoring the
  source. Use that exact chosen folder as \`<plan-dir>\` in every local CLI command
  below.
- Run \`npx @agent-native/core@latest plan local check --dir <plan-dir>\` before
  any preview. When the hosted Plan UI is reachable, run
  \`npx @agent-native/core@latest plan local serve --dir <plan-dir> --kind recap --open\`.
  Report the returned local bridge URL from stdout or \`<plan-dir>/.plan-url\`.
  Treat \`.plan-url\` as a local token file and do not commit it. The URL opens
  the hosted Plan UI but reads from the localhost bridge on this machine, so it
  is not shareable across machines. On macOS, \`--open\` prefers Chromium browsers;
  if Safari opens, switch to Chrome/Chromium because Safari can block the hosted
  HTTPS page from fetching the HTTP localhost bridge. If the Plan app itself is
  running locally with the same \`PLAN_LOCAL_DIR\`, the \`/local-plans/<slug>\` route
  is also valid. In a truly offline environment, hand off the local \`<plan-dir>\`
  path after \`plan local check\` and note that interactive preview requires either
  network access to the hosted Plan UI or a running local Plan app.
- For headless verification, run
  \`npx @agent-native/core@latest plan local verify --dir <plan-dir> --kind recap\`.
  It starts the bridge, checks the private-network preflight and JSON payload,
  prints diagnostics, and exits. If the browser hangs on "Loading plan", fetch
  the \`bridgeUrl\` from the verify/serve JSON to read the concrete validation
  error.
- Do **not** call \`create-visual-recap\`, \`create-visual-plan\`,
  \`import-visual-plan-source\`, \`update-visual-plan\`,
  \`patch-visual-plan-source\`, \`get-plan-feedback\`, \`export-visual-plan\`,
  \`set-resource-visibility\`, or any hosted Plan tool for that recap except the
  schema-only block catalog lookup above.
- Treat review feedback as file or chat feedback: update the MDX files directly,
  rerun \`plan local check\`, and rerun \`serve\` or \`verify\` only when that preview
  path is available. Summarize the new local URL when one exists; otherwise
  summarize the checked local folder path.
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

Some clients lazy-load connector tools through a deferred tool registry instead
of showing the \`plan\` namespace upfront. Before declaring the Plan connector
missing, search/load tools with the host's discovery surface (\`tool_search\` when
available) for \`create_visual_recap\`, \`create_visual_plan\`, or
\`get_plan_blocks\`, then use the Plan MCP tools it exposes.

Except for the explicit local-files privacy mode above, if neither the \`plan\`
nor legacy \`agent-native-plans\` Plan MCP tools are available after deferred tool
discovery, do NOT improvise an inline recap as a fallback. Do not report the
connector as disconnected just because it is named \`agent-native-plans\` instead
of \`plan\`, or because the tools were not visible before discovery. The usual
cause is a connector that did not finish connecting this session (it registers
zero tools), NOT necessarily an auth problem — so do not assume the user must
authenticate. Stop and tell the user how to restore it for their current client: in
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

## Top Canvas Recaps — read \`../visual-plan/references/canvas.md\`

When a recap includes a top canvas, storyboard, or flow view, READ
\`../visual-plan/references/canvas.md\` before authoring \`canvas.mdx\`. Recap
canvas artboards must use the same HTML wireframe path as good document-body
wireframes: \`<Screen surface="..." html={...} />\` with a semantic HTML fragment.
Do not author fresh kit-tree children such as \`<FrameScreen>\`, \`<Card>\`,
\`<Row>\`, \`<Title>\`, or \`<Btn>\` inside canvas \`<Screen>\` tags. Those components
are legacy compatibility markup for old plans; in new canvas storyboards they
can produce cramped or overlapping layouts even when the inline body wireframe
looks good. If a canvas mockup looks worse than the same screen below the fold,
assume it used the legacy kit path and replace it with an HTML screen.

## Open And Report The Recap

In local-files privacy mode, run \`plan local check\` first, then report the local
bridge URL from
\`npx @agent-native/core@latest plan local serve --dir <plan-dir> --kind recap --open\`
or from \`<plan-dir>/.plan-url\`. It opens the hosted Plan UI but reads from the
localhost bridge on this machine, so it is not shareable across machines. If the
Plan app itself is running locally with the same \`PLAN_LOCAL_DIR\`, the
\`/local-plans/<slug>\` route is also valid. Do not invent a hosted database URL
and do not publish just to get an absolute Plan link.

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
  The renderer's wide document layout is intentionally allowlisted: \`diff\`,
  \`annotated-code\`, vertical \`tabs\`, and \`tabs\` containing diff-like children
  break out wider than prose. Do not put API endpoints, OpenAPI specs, data
  models, JSON explorers, wireframes, question forms, or custom HTML into tabs
  merely to make them wide.
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

**Before writing any structured plan content, fetch/read the block catalog.** In
hosted or self-hosted mode, call \`get-plan-blocks\` on the Plan MCP connector
(\`plan\` or legacy \`agent-native-plans\`). If no Plan tools are visible yet in a
lazy-loading client, search/load them through the host's tool discovery surface
first (\`tool_search\` when available). In local-files mode, or when the skill was
installed as plain text and no MCP tools are registered after discovery, run
\`npx @agent-native/core@latest plan blocks --out plan-blocks.md\` and read that
file first. The CLI command calls the public no-auth \`get-plan-blocks\` route and
sends no plan/recap content. If network access is unavailable, use the bundled
references and validate with \`plan local check\`; run \`plan local serve\` only
when the hosted Plan UI is reachable or a local Plan app is already running.

The catalog returns the authoritative, always-current block vocabulary generated
live from the app's own block registry — the same config the renderer and MDX
round-trip use — so it can never be stale even if this SKILL.md is an old
installed copy:

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
- Every capitalized block component must be self-closing (\`<RichText ... />\`) or
  explicitly closed around children (\`<RichText ...>...</RichText>\`). Never
  leave a bare opening tag like \`<RichText ...>\` in a paragraph; MDX treats it
  as unclosed JSX and import fails before the recap can render.
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

In hosted mode, because a recap is a real, editable plan, the same review loop
as forward plans applies: a reviewer can annotate any block, and the coding
agent reads \`get-plan-feedback\` to drive fixes back into the code — annotation →
agent → diff, the same close-the-loop flow forward plans use. After a reviewer
annotates a block, call \`get-plan-feedback\` to read the structured feedback,
then either update the recap with \`create-visual-recap\` (passing the existing
\`planId\` to replace it in place) or apply targeted changes with
\`update-visual-plan\`. The loop is live and wired. In local-files privacy mode,
do not call those hosted tools; read review notes from chat or local files, edit
\`<plan-dir>/*.mdx\` directly, and rerun \`plan local check\`, \`serve\`, or \`verify\`
for \`<plan-dir>\`. The one thing not yet automatic is PR-comment-triggered
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
  content: {
    skillName: "content",
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "content",
      displayName: "Content",
      description:
        "Edit docs, blogs, resources, and MDX content through the Content app, including repo-backed Local File Mode.",
      hosted: {
        url: "https://content.agent-native.com",
        mcpUrl: "https://content.agent-native.com/_agent-native/mcp",
      },
      mcp: { serverName: "agent-native-content" },
      auth: {
        mode: "oauth",
        setup:
          "Authenticate with the Content MCP connector in the host app. Local File Mode requires a local Content app, Agent Native Desktop, or trusted local bridge for filesystem access.",
      },
      surfaces: [
        {
          id: "content-documents",
          action: "list-documents",
          path: "/",
        },
        {
          id: "content-local-files",
          action: "share-local-file-document",
          path: "/local-files",
        },
      ],
      skills: [
        {
          path: "skills/content",
          visibility: "exported",
          exportAs: "content",
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
    skillMarkdown: CONTENT_SKILL_MD,
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
          "The marketplace plugin uses hosted Agent-Native Plans by default. To choose local-files or self-hosted mode, install with the Agent-Native CLI. Authenticate only for hosted/account-backed sharing.",
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
type ModeAwareAppSkillId = "visual-plans" | "content";

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
  content: "content",
  docs: "content",
  documents: "content",
  "local-content": "content",
  "content-local-files": "content",
  "agent-native-content": "content",
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
  content: [
    "docs",
    "documents",
    "local-content",
    "content-local-files",
    "agent-native-content",
  ],
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
  cursor: "Cursor",
  opencode: "OpenCode",
  "github-copilot": "GitHub Copilot / VS Code",
};

const CLIENT_HINTS: Record<ClientId, string> = {
  "claude-code": ".mcp.json or ~/.claude.json",
  "claude-code-cli": ".mcp.json or ~/.claude.json",
  codex: "$CODEX_HOME/config.toml or ~/.codex/config.toml",
  cowork: "~/.cowork/mcp.json",
  cursor: ".cursor/mcp.json or ~/.cursor/mcp.json",
  opencode: "opencode.json or ~/.config/opencode/opencode.json",
  "github-copilot": ".vscode/mcp.json or VS Code user mcp.json",
};

type SkillInstructionClientId = ClientId | "pi";

const SKILLS_CLIENTS: ClientId[] = [
  "claude-code",
  "codex",
  "cowork",
  "cursor",
  "opencode",
  "github-copilot",
];
const SKILL_INSTRUCTION_CLIENTS: SkillInstructionClientId[] = [
  "codex",
  "claude-code",
  "pi",
];
const SKILL_INSTRUCTION_PROMPT_CLIENTS: SkillInstructionClientId[] = [
  "codex",
  "claude-code",
];
// Clients that don't write their own instruction files but READ the shared
// `.agents/skills` path the codex install writes. In instructions/local-files
// mode they resolve to that shared-agents install instead of being dropped, so
// `--client cursor --mode local-files` (etc.) installs the skills they read
// rather than failing with an empty client set.
const SHARED_AGENTS_READER_CLIENTS = new Set<SkillInstructionClientId>([
  "cursor",
  "opencode",
  "github-copilot",
  "cowork",
]);
const SKILL_INSTRUCTION_CLIENT_LABELS: Record<
  SkillInstructionClientId,
  string
> = {
  "claude-code": "Claude Code",
  "claude-code-cli": "Claude Code",
  codex: "Shared .agents skills",
  cowork: "MCP only",
  pi: "Pi",
};
const SKILL_INSTRUCTION_CLIENT_HINTS: Record<SkillInstructionClientId, string> =
  {
    "claude-code":
      "Also write Claude Code's native .claude/skills and commands files.",
    "claude-code-cli":
      "Also write Claude Code's native .claude/skills and commands files.",
    codex:
      "Project scope writes .agents skills/commands for Codex, Pi, Cursor, OpenCode, Copilot, and similar agents; user scope writes Codex's ~/.codex skills/commands.",
    cowork: "MCP only",
    pi: "Project scope writes .agents/skills plus .pi/prompts; user scope writes ~/.agents/skills plus ~/.pi/agent/prompts.",
  };

type SkillsCommand = "list" | "add" | "status" | "update" | "help";
type PlanInstallMode = "hosted" | "local-files" | "self-hosted";

export interface ParsedSkillsArgs {
  command: SkillsCommand;
  target?: string;
  baseDir?: string;
  client: string;
  clientExplicit: boolean;
  clients?: SkillInstructionClientId[];
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
   * Storage/backend mode for app-backed skills that support install modes. The
   * field name is kept for CLI/API compatibility with the original Plan-only
   * implementation.
   */
  planMode?: PlanInstallMode;
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
  localManifestPath?: string;
  planMode?: PlanInstallMode;
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
  planMode?: PlanInstallMode;
}

interface SkillFolderBundle {
  appSkillId: BuiltInAppSkillId;
  displayName: string;
  skillName: string;
  mcpUrl: string;
  files: Record<string, string>;
  contentHash: string;
  planMode?: PlanInstallMode;
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
  planMode?: PlanInstallMode;
  mcpUrl?: string;
  current: boolean;
  managed: boolean;
}

interface ScaffoldGuidanceState {
  kind: "workspace-core" | "standalone";
  displayName: string;
  templateName: "workspace-core" | "headless" | "default";
  path: string;
  sourcePath: string;
  projectRoot: string;
  workspaceRoot?: string;
  sharedPackageDir?: string;
  current: boolean;
  skillCount: number;
}

interface SkillInstallTarget {
  id: string;
  displayName: string;
  loaded: LoadedAppSkillManifest;
  skillNames: string[];
  modeAwareId?: ModeAwareAppSkillId;
  materializeInstructions(outDir: string): string;
  cleanup?: () => void;
}

interface RunCommandOptions {
  stdio?: "inherit" | "stderr" | "silent";
}

export type SkillsCatalogMode = "agent-native" | "all";

export interface PublicSkillCatalogEntry {
  name: string;
  description?: string;
}

interface ConnectSpinner {
  start(message?: string): void;
  clear(): void;
}

export interface RunSkillsOptions {
  baseDir?: string;
  /**
   * Which skills appear in the shared add/list picker. `agent-native` is the
   * core CLI surface; `all` is used by @agent-native/skills to append public
   * skill-repo entries while keeping every prompt and install decision here.
   */
  catalogMode?: SkillsCatalogMode;
  /**
   * The plain skills repo/source to install when a public catalog entry is
   * selected. @agent-native/skills usually passes the materialized source root.
   */
  publicSkillSource?: string;
  /**
   * Public skill-repo entries discovered by @agent-native/skills. Core owns the
   * user-facing flow; the wrapper owns materializing the broader catalog.
   */
  publicSkillEntries?: PublicSkillCatalogEntry[];
  /**
   * Built-in Agent Native skill prompt/list entries to hide for wrapper CLIs.
   * Direct installs by explicit name still work; this only controls discovery.
   */
  hiddenBuiltInSkillTargets?: string[];
  isInteractive?: () => boolean;
  log?: (message: string) => void;
  /**
   * Optional output hook for the embedded `agent-native connect` transcript.
   * Defaults to `log`; the clack-based CLI uses this to render the multi-line
   * auth details as one continuous guide block instead of separate status logs.
   */
  connectLog?: (message: string) => void;
  /**
   * Optional spinner factory for the embedded connect flow. The default CLI only
   * enables this for real TTYs so captured/test output stays deterministic.
   */
  createConnectSpinner?: () => ConnectSpinner | undefined;
  promptClients?: (
    context: SkillsClientPromptContext,
  ) => Promise<SkillInstructionClientId[] | null>;
  promptSkills?: (
    context: SkillsTargetPromptContext,
  ) => Promise<string[] | null>;
  promptGithubAction?: (
    context: SkillsGithubActionPromptContext,
  ) => Promise<boolean | null>;
  promptScope?: (
    context: SkillsScopePromptContext,
  ) => Promise<"project" | "user" | null>;
  promptPlanMode?: (
    context: SkillsPlanModePromptContext,
  ) => Promise<PlanInstallMode | null>;
  promptPlanMcpUrl?: () => Promise<string | null>;
  promptUpdateInstructions?: () => Promise<boolean | null>;
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
  initialClients: SkillInstructionClientId[];
  options: Array<{
    value: SkillInstructionClientId;
    label: string;
    hint: string;
  }>;
  installsMcp: boolean;
}

interface SkillsTargetPromptContext {
  initialTargets: string[];
  options: Array<{ value: string; label: string; hint: string }>;
}

interface SkillsGithubActionPromptContext {
  workflowPath: string;
  setupCommand: string;
  docsUrl: string;
}

interface SkillsScopePromptContext {
  initialScope: "project" | "user";
}

interface SkillsPlanModePromptContext {
  initialMode: PlanInstallMode;
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

function targetSupportsInstallMode(
  targetId: string | undefined,
): targetId is ModeAwareAppSkillId {
  return targetId === "visual-plans" || targetId === "content";
}

function localFilesModeSkipsMcp(
  targetId: string | undefined,
  mode: PlanInstallMode | undefined,
): boolean {
  return mode === "local-files" && targetSupportsInstallMode(targetId);
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

function insertAfterFrontmatter(markdown: string, block: string): string {
  if (!block.trim()) return markdown;
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return `${block}\n\n${markdown}`;
  return `${match[0]}\n${block.trim()}\n\n${markdown.slice(match[0].length)}`;
}

function planModeInstructionBlock(input: {
  mode: PlanInstallMode | undefined;
  mcpUrl?: string;
}): string {
  if (input.mode === "local-files") {
    return `## Installed Mode

Default storage for this installation: local files. Create and update plans and
recaps as MDX folders under \`plans/<slug>/\` when they should be checked in, or
under a repo-ignored/temp folder when they should stay private scratch. Before
authoring structured MDX, run
\`npx @agent-native/core@latest plan blocks --out plan-blocks.md\` and read the
no-auth block catalog; it sends no plan content. Then run
\`npx @agent-native/core@latest plan local check --dir plans/<slug>\`, then
\`npx @agent-native/core@latest plan local serve --dir plans/<slug> --kind plan|recap --open\`,
and report the local bridge URL from stdout or \`plans/<slug>/.plan-url\`. Treat
\`.plan-url\` as a local token file and do not commit it. It opens the hosted Plan
UI but reads from the localhost bridge on this machine, so it is not shareable
across machines. On macOS, use Chrome/Chromium if Safari blocks the localhost
bridge; run \`plan local verify --dir plans/<slug> --kind plan|recap\` for
headless diagnostics. No sharing, all local. Use a hosted or self-hosted Plan MCP
connector only if the user explicitly asks to publish or share.`;
  }
  if (input.mode === "self-hosted") {
    return `## Installed Mode

Default storage for this installation: the configured self-hosted/custom Plan
app${input.mcpUrl ? ` at \`${input.mcpUrl}\`` : ""}. Use that Plan MCP connector
for plans and recaps instead of assuming \`https://plan.agent-native.com\`.`;
  }
  return "";
}

function contentModeInstructionBlock(input: {
  mode: PlanInstallMode | undefined;
  mcpUrl?: string;
}): string {
  if (input.mode === "local-files") {
    return `## Installed Mode

Default storage for this installation: Content Local File Mode. This repo should
have an \`agent-native.json\` file with \`apps.content.mode: "local-files"\`;
the installer writes one if missing and fills in default roots for \`docs/\`,
\`blog/\`, \`content/\`, and \`resources/\`. Prefer Content document actions
when a local Content app,
Agent Native Desktop, or another trusted local bridge exposes them. If those
tools are not currently available, edit the configured Markdown/MDX files and
local components directly, preserving frontmatter, imports, JSX, and unknown MDX
syntax. The hosted Content app cannot read private repo files by itself.`;
  }
  if (input.mode === "self-hosted") {
    return `## Installed Mode

Default storage for this installation: the configured self-hosted/custom Content
app${input.mcpUrl ? ` at \`${input.mcpUrl}\`` : ""}. Use that Content MCP
connector instead of assuming \`https://content.agent-native.com\`.`;
  }
  return "";
}

function applyInstallModeToSkillMarkdown(
  markdown: string,
  input: {
    appSkillId: BuiltInAppSkillId;
    mode?: PlanInstallMode;
    mcpUrl?: string;
  },
): string {
  let block = "";
  if (input.appSkillId === "visual-plans") {
    block = planModeInstructionBlock({
      mode: input.mode,
      mcpUrl: input.mcpUrl,
    });
  } else if (input.appSkillId === "content") {
    block = contentModeInstructionBlock({
      mode: input.mode,
      mcpUrl: input.mcpUrl,
    });
  }
  return insertAfterFrontmatter(markdown, block);
}

function skillFilesForBuiltIn(
  appSkillId: BuiltInAppSkillId,
  options: { planMode?: PlanInstallMode; mcpUrl?: string } = {},
): Record<string, SkillFolderBundle> {
  const entry = BUILT_IN_APP_SKILLS[appSkillId];
  const skills: Record<string, string> = {
    [entry.skillName]: applyInstallModeToSkillMarkdown(entry.skillMarkdown, {
      appSkillId,
      mode: options.planMode,
      mcpUrl: options.mcpUrl,
    }),
    ...builtInExtraSkills(entry),
  };
  for (const [skillName, skillMarkdown] of Object.entries(
    builtInExtraSkills(entry),
  )) {
    skills[skillName] = applyInstallModeToSkillMarkdown(skillMarkdown, {
      appSkillId,
      mode: options.planMode,
      mcpUrl: options.mcpUrl,
    });
  }
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
      mcpUrl:
        isLocalOnlyBuiltInSkill(entry) ||
        localFilesModeSkipsMcp(appSkillId, options.planMode)
          ? ""
          : (options.mcpUrl ?? entry.manifest.hosted.mcpUrl),
      files,
      contentHash: stableSkillHash(files),
      planMode: options.planMode,
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
    ...(bundle.planMode ? { planMode: bundle.planMode } : {}),
  };
  fs.writeFileSync(
    path.join(dir, AGENT_NATIVE_SKILL_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf-8",
  );
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function defaultContentLocalFilesAppConfig(): Record<string, unknown> {
  return {
    mode: "local-files",
    roots: [
      {
        name: "Docs",
        path: "docs",
        kind: "docs",
        extensions: [".md", ".mdx"],
      },
      {
        name: "Blog",
        path: "blog",
        kind: "blog",
        extensions: [".md", ".mdx"],
      },
      {
        name: "Content",
        path: "content",
        kind: "content",
        extensions: [".md", ".mdx"],
      },
      {
        name: "Resources",
        path: "resources",
        kind: "resources",
        extensions: [".md", ".mdx"],
      },
    ],
    components: "components",
    extensions: "extensions",
    hide: ["**/_*.md", "**/_*.mdx"],
  };
}

function contentLocalFilesManifestPath(baseDir: string): string {
  return path.join(baseDir, "agent-native.json");
}

function shouldWriteContentLocalFilesManifest(
  targetId: string | undefined,
  mode: PlanInstallMode | undefined,
): boolean {
  return targetId === "content" && mode === "local-files";
}

function mergeContentLocalFilesManifest(
  existing: unknown,
): Record<string, unknown> {
  const manifest = isJsonRecord(existing) ? { ...existing } : {};
  if (manifest.version === undefined) manifest.version = 1;

  const apps = isJsonRecord(manifest.apps) ? { ...manifest.apps } : {};
  const contentApp = isJsonRecord(apps.content) ? { ...apps.content } : {};
  const defaults = defaultContentLocalFilesAppConfig();
  contentApp.mode = "local-files";
  if (!Array.isArray(contentApp.roots) || contentApp.roots.length === 0) {
    contentApp.roots = defaults.roots;
  }
  if (contentApp.components === undefined) {
    contentApp.components = defaults.components;
  }
  if (contentApp.extensions === undefined) {
    contentApp.extensions = defaults.extensions;
  }
  if (!Array.isArray(contentApp.hide) || contentApp.hide.length === 0) {
    contentApp.hide = defaults.hide;
  }
  apps.content = contentApp;
  manifest.apps = apps;
  return manifest;
}

function writeContentLocalFilesManifest(
  baseDir: string,
  options: { dryRun?: boolean } = {},
): string {
  const manifestPath = contentLocalFilesManifestPath(baseDir);
  let existing: unknown = {};
  if (fs.existsSync(manifestPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (error: any) {
      throw new Error(
        `Could not parse ${manifestPath}: ${error?.message ?? error}`,
      );
    }
  }
  const manifest = mergeContentLocalFilesManifest(existing);
  if (!options.dryRun) {
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf-8",
    );
  }
  return manifestPath;
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
    if (agent === "codex") return path.join(baseDir, ".agents", "skills");
    if (agent === "pi") return path.join(baseDir, ".agents", "skills");
    return path.join(baseDir, ".claude", "skills");
  }
  if (agent === "codex") {
    return process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, "skills")
      : path.join(home, ".codex", "skills");
  }
  if (agent === "pi") {
    return path.join(home, ".agents", "skills");
  }
  return path.join(home, ".claude", "skills");
}

function builtInCommandsRootForAgent(
  agent: string,
  scope: "project" | "user",
  baseDir: string,
): string {
  const home = homeDir() ?? baseDir;
  if (scope === "project") {
    if (agent === "codex") return path.join(baseDir, ".agents", "commands");
    if (agent === "pi") return path.join(baseDir, ".pi", "prompts");
    return path.join(baseDir, ".claude", "commands");
  }
  if (agent === "codex") {
    return process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, "commands")
      : path.join(home, ".codex", "commands");
  }
  if (agent === "pi") {
    const piHome =
      process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
    return path.join(piHome, "prompts");
  }
  return path.join(home, ".claude", "commands");
}

function slashCommandForBuiltInSkill(skillName: string): string | null {
  if (skillName === "visual-plan") {
    return `---
description: Create an interactive Agent-Native visual plan for the current task.
argument-hint: [optional request or scope]
---

Use the visual-plan skill for this task. Treat any arguments as the user's
requested plan scope or focus:

$ARGUMENTS
`;
  }
  if (skillName === "visual-recap") {
    return `---
description: Create an interactive Agent-Native visual recap for a PR, branch, commit, or diff.
argument-hint: [PR, branch, commit, diff, or scope]
---

Use the visual-recap skill. Treat any arguments as the recap target or focus:

$ARGUMENTS
`;
  }
  return null;
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
  planMode?: PlanInstallMode;
  mcpUrl?: string;
}): string[] {
  const bundles = Object.values(
    skillFilesForBuiltIn(input.appSkillId, {
      planMode: input.planMode,
      mcpUrl: input.mcpUrl,
    }),
  ).filter(
    (bundle) =>
      !input.onlySkillNames || input.onlySkillNames.includes(bundle.skillName),
  );
  const written: string[] = [];
  for (const agent of input.skillsAgents) {
    const root = builtInSkillsRootForAgent(agent, input.scope, input.baseDir);
    const commandsRoot = builtInCommandsRootForAgent(
      agent,
      input.scope,
      input.baseDir,
    );
    for (const bundle of bundles) {
      const dir = path.join(root, bundle.skillName);
      if (!input.dryRun) writeSkillFolder(dir, bundle);
      written.push(dir);
      const command = slashCommandForBuiltInSkill(bundle.skillName);
      if (command) {
        const commandPath = path.join(commandsRoot, `${bundle.skillName}.md`);
        if (!input.dryRun) {
          fs.mkdirSync(path.dirname(commandPath), { recursive: true });
          fs.writeFileSync(commandPath, command, "utf-8");
        }
        written.push(commandPath);
      }
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
  clients: SkillInstructionClientId[];
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
  const clientSet = new Set<SkillInstructionClientId>(input.clients);
  const includeAll = input.clients.length === 0;
  const hasClient = (client: SkillInstructionClientId) =>
    includeAll || clientSet.has(client);
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
    if (hasClient("pi")) {
      add(path.join(input.baseDir, ".agents", "skills"), "project", "pi");
      add(path.join(input.baseDir, ".pi", "skills"), "project", "pi");
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
    if (hasClient("pi")) {
      const piHome =
        process.env.PI_CODING_AGENT_DIR ||
        (home ? path.join(home, ".pi", "agent") : undefined);
      add(
        home ? path.join(home, ".agents", "skills") : undefined,
        "user",
        "pi",
      );
      add(piHome ? path.join(piHome, "skills") : undefined, "user", "pi");
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

const SCAFFOLD_GUIDANCE_TARGETS = new Set([
  "scaffold",
  "generated",
  "generated-app",
  "generated-workspace",
  "workspace",
  "workspace-core",
  "framework-guidance",
]);

function isScaffoldGuidanceTarget(value: string | undefined): boolean {
  if (!value) return false;
  return SCAFFOLD_GUIDANCE_TARGETS.has(value.trim().toLowerCase());
}

function corePackageRootDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../..");
}

function bundledScaffoldSkillsDir(
  templateName: ScaffoldGuidanceState["templateName"],
): string {
  return path.join(
    corePackageRootDir(),
    "src",
    "templates",
    templateName,
    ".agents",
    "skills",
  );
}

function readJsonRecord(file: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}
  return undefined;
}

function readPackageJson(dir: string): Record<string, unknown> | undefined {
  return readJsonRecord(path.join(dir, "package.json"));
}

function packageName(pkg: Record<string, unknown> | undefined): string | null {
  return typeof pkg?.name === "string" ? pkg.name : null;
}

function workspaceCorePackageName(
  pkg: Record<string, unknown> | undefined,
): string | null {
  const agentNative = pkg?.["agent-native"];
  if (
    agentNative &&
    typeof agentNative === "object" &&
    !Array.isArray(agentNative) &&
    typeof (agentNative as Record<string, unknown>).workspaceCore === "string"
  ) {
    return (agentNative as Record<string, string>).workspaceCore;
  }
  return null;
}

function hasAgentNativeCoreDependency(
  pkg: Record<string, unknown> | undefined,
): boolean {
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg?.[field];
    if (
      deps &&
      typeof deps === "object" &&
      !Array.isArray(deps) &&
      "@agent-native/core" in deps
    ) {
      return true;
    }
  }
  return false;
}

function findWorkspaceCorePackageDir(
  workspaceRoot: string,
  workspaceCoreName: string,
): string | undefined {
  const packagesDir = path.join(workspaceRoot, "packages");
  if (!fs.existsSync(packagesDir)) return undefined;
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(packagesDir, entry.name);
    if (packageName(readPackageJson(candidate)) === workspaceCoreName) {
      return candidate;
    }
  }
  const fallback = path.join(workspaceRoot, "packages", "shared");
  return fs.existsSync(path.join(fallback, "package.json"))
    ? fallback
    : undefined;
}

function findGeneratedWorkspace(startDir: string):
  | {
      workspaceRoot: string;
      sharedPackageDir: string;
    }
  | undefined {
  let current = path.resolve(startDir);
  while (true) {
    const pkg = readPackageJson(current);
    const workspaceCoreName = workspaceCorePackageName(pkg);
    if (workspaceCoreName && fs.existsSync(path.join(current, "apps"))) {
      const sharedPackageDir = findWorkspaceCorePackageDir(
        current,
        workspaceCoreName,
      );
      if (sharedPackageDir) {
        return { workspaceRoot: current, sharedPackageDir };
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function detectStandaloneScaffoldTemplate(
  projectRoot: string,
): "headless" | "default" | undefined {
  const pkg = readPackageJson(projectRoot);
  if (!hasAgentNativeCoreDependency(pkg)) return undefined;
  if (!fs.existsSync(path.join(projectRoot, ".agents", "skills"))) {
    return undefined;
  }

  const hasAppDir = fs.existsSync(path.join(projectRoot, "app"));
  const hasHeadlessHello = fs.existsSync(
    path.join(projectRoot, "actions", "hello.ts"),
  );
  if (!hasAppDir && hasHeadlessHello) return "headless";

  const looksLikeDefaultTemplate =
    fs.existsSync(path.join(projectRoot, "app", "routes", "database.tsx")) &&
    fs.existsSync(path.join(projectRoot, "app", "routes", "_index.tsx")) &&
    fs.existsSync(path.join(projectRoot, "actions", "view-screen.ts"));
  return looksLikeDefaultTemplate ? "default" : undefined;
}

function listImmediateSkillDirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function skillDirContentsMatch(sourceDir: string, targetDir: string): boolean {
  const expected = listSkillFolderFiles(sourceDir);
  const actual = listSkillFolderFiles(targetDir);
  const expectedFiles = Object.keys(expected).sort();
  const actualFiles = Object.keys(actual).sort();
  if (expectedFiles.length !== actualFiles.length) return false;
  for (let i = 0; i < expectedFiles.length; i += 1) {
    if (expectedFiles[i] !== actualFiles[i]) return false;
  }
  return expectedFiles.every((file) => expected[file] === actual[file]);
}

function scaffoldGuidanceCurrent(
  sourceRoot: string,
  targetRoot: string,
): boolean {
  const skills = listImmediateSkillDirs(sourceRoot);
  if (skills.length === 0) return false;
  return skills.every((skill) =>
    skillDirContentsMatch(
      path.join(sourceRoot, skill),
      path.join(targetRoot, skill),
    ),
  );
}

function collectScaffoldGuidanceStates(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): ScaffoldGuidanceState[] {
  if (parsed.target && !isScaffoldGuidanceTarget(parsed.target)) return [];
  if (parsed.scopeExplicit && parsed.scope !== "project") return [];

  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const workspace = findGeneratedWorkspace(baseDir);
  if (workspace) {
    const sourcePath = bundledScaffoldSkillsDir("workspace-core");
    const targetPath = path.join(
      workspace.sharedPackageDir,
      ".agents",
      "skills",
    );
    if (!fs.existsSync(sourcePath)) return [];
    return [
      {
        kind: "workspace-core",
        displayName: "Generated workspace framework skills",
        templateName: "workspace-core",
        path: targetPath,
        sourcePath,
        projectRoot: workspace.workspaceRoot,
        workspaceRoot: workspace.workspaceRoot,
        sharedPackageDir: workspace.sharedPackageDir,
        current: scaffoldGuidanceCurrent(sourcePath, targetPath),
        skillCount: listImmediateSkillDirs(sourcePath).length,
      },
    ];
  }

  const templateName = detectStandaloneScaffoldTemplate(baseDir);
  if (!templateName) return [];
  const sourcePath = bundledScaffoldSkillsDir(templateName);
  const targetPath = path.join(baseDir, ".agents", "skills");
  if (!fs.existsSync(sourcePath)) return [];
  return [
    {
      kind: "standalone",
      displayName: `Generated ${templateName} app framework skills`,
      templateName,
      path: targetPath,
      sourcePath,
      projectRoot: baseDir,
      current: scaffoldGuidanceCurrent(sourcePath, targetPath),
      skillCount: listImmediateSkillDirs(sourcePath).length,
    },
  ];
}

function copyScaffoldGuidanceSkills(
  sourceRoot: string,
  targetRoot: string,
): void {
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const skill of listImmediateSkillDirs(sourceRoot)) {
    const targetSkillDir = path.join(targetRoot, skill);
    if (
      fs.existsSync(targetSkillDir) &&
      fs.lstatSync(targetSkillDir).isSymbolicLink()
    ) {
      continue;
    }
    fs.rmSync(targetSkillDir, { recursive: true, force: true });
    fs.cpSync(path.join(sourceRoot, skill), targetSkillDir, {
      recursive: true,
    });
  }
}

function updateScaffoldGuidanceStates(
  states: ScaffoldGuidanceState[],
  dryRun: boolean,
): ScaffoldGuidanceState[] {
  const updated: ScaffoldGuidanceState[] = [];
  for (const state of states) {
    if (state.current) continue;
    if (!dryRun) {
      copyScaffoldGuidanceSkills(state.sourcePath, state.path);
    }
    updated.push({
      ...state,
      current: !dryRun,
    });
  }
  return updated;
}

function ensureWorkspaceRootSkillsLink(
  workspaceRoot: string,
  sharedPackageDir: string,
): void {
  const sharedSkillsDir = path.join(sharedPackageDir, ".agents", "skills");
  if (!fs.existsSync(sharedSkillsDir)) return;

  const agentsDir = path.join(workspaceRoot, ".agents");
  const linkPath = path.join(agentsDir, "skills");
  const target = path.relative(agentsDir, sharedSkillsDir);

  fs.mkdirSync(agentsDir, { recursive: true });
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      if (fs.readlinkSync(linkPath) === target) return;
      fs.unlinkSync(linkPath);
    } else {
      copyScaffoldGuidanceSkills(sharedSkillsDir, linkPath);
      return;
    }
  } catch {}

  try {
    fs.symlinkSync(
      target,
      linkPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch {
    try {
      fs.cpSync(sharedSkillsDir, linkPath, { recursive: true });
    } catch {}
  }
}

function refreshCopiedClaudeSkills(projectRoot: string): void {
  const agentsSkillsDir = path.join(projectRoot, ".agents", "skills");
  const claudeSkillsDir = path.join(projectRoot, ".claude", "skills");
  if (!fs.existsSync(agentsSkillsDir) || !fs.existsSync(claudeSkillsDir)) {
    return;
  }
  try {
    if (fs.lstatSync(claudeSkillsDir).isSymbolicLink()) return;
    copyScaffoldGuidanceSkills(agentsSkillsDir, claudeSkillsDir);
  } catch {}
}

function repairScaffoldAgentLinks(states: ScaffoldGuidanceState[]): void {
  const seen = new Set<string>();
  for (const state of states) {
    if (state.workspaceRoot && state.sharedPackageDir) {
      const key = `workspace:${state.workspaceRoot}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ensureWorkspaceRootSkillsLink(
        state.workspaceRoot,
        state.sharedPackageDir,
      );
      setupAgentSymlinks(state.workspaceRoot);
      refreshCopiedClaudeSkills(state.workspaceRoot);
      setupAgentSymlinks(state.sharedPackageDir);
      refreshCopiedClaudeSkills(state.sharedPackageDir);
      const appsDir = path.join(state.workspaceRoot, "apps");
      if (fs.existsSync(appsDir)) {
        for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const appDir = path.join(appsDir, entry.name);
          if (fs.existsSync(path.join(appDir, "package.json"))) {
            setupAgentSymlinks(appDir);
            refreshCopiedClaudeSkills(appDir);
          }
        }
      }
      continue;
    }

    const key = `standalone:${state.projectRoot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    setupAgentSymlinks(state.projectRoot);
    refreshCopiedClaudeSkills(state.projectRoot);
  }
}

function targetIdsForStatus(parsed: ParsedSkillsArgs): BuiltInAppSkillId[] {
  if (isScaffoldGuidanceTarget(parsed.target)) return [];
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

function clientFilterForStatus(
  parsed: ParsedSkillsArgs,
): SkillInstructionClientId[] {
  return parsed.clientExplicit ? resolveSkillsClientArg(parsed.client) : [];
}

function collectSkillInstallStates(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): SkillInstallState[] {
  const appSkillIds = targetIdsForStatus(parsed);
  const defaultLatest = latestSkillBundlesForTargets(appSkillIds);
  const roots = skillSearchRoots({
    baseDir: options.baseDir ?? process.cwd(),
    clients: clientFilterForStatus(parsed),
    scopes: scopeFilterForStatus(parsed),
  });
  const states: SkillInstallState[] = [];
  const seenDirs = new Set<string>();

  for (const root of roots) {
    for (const bundle of Object.values(defaultLatest)) {
      const dir = path.join(root.root, bundle.skillName);
      const resolvedDir = path.resolve(dir);
      if (seenDirs.has(resolvedDir) || !fs.existsSync(dir)) continue;
      if (!fs.existsSync(path.join(dir, "SKILL.md"))) continue;
      seenDirs.add(resolvedDir);
      const files = listSkillFolderFiles(dir);
      const metadata = readSkillInstallMetadata(dir);
      const stateBundle =
        skillFilesForBuiltIn(bundle.appSkillId, {
          planMode: metadata?.planMode,
          mcpUrl: metadata?.mcpUrl,
        })[bundle.skillName] ?? bundle;
      const installedHash =
        Object.keys(files).length > 0 ? stableSkillHash(files) : null;
      states.push({
        appSkillId: stateBundle.appSkillId,
        displayName: stateBundle.displayName,
        skillName: stateBundle.skillName,
        path: dir,
        root: root.root,
        scope: root.scope,
        client: root.client,
        latestHash: stateBundle.contentHash,
        installedHash,
        metadataHash: metadata?.contentHash,
        current: installedHash === stateBundle.contentHash,
        managed: metadata?.source === "agent-native",
        planMode: metadata?.planMode,
        mcpUrl: metadata?.mcpUrl,
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
  const updated: SkillInstallState[] = [];
  for (const state of states) {
    if (state.current && state.managed) continue;
    const bundle = skillFilesForBuiltIn(state.appSkillId, {
      planMode: state.planMode,
      mcpUrl: state.mcpUrl,
    })[state.skillName];
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

function isMcpClientId(value: SkillInstructionClientId): value is ClientId {
  return (CLIENTS as string[]).includes(value);
}

function normalizeSkillInstructionClientIds(
  values: unknown,
): SkillInstructionClientId[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<SkillInstructionClientId>();
  const out: SkillInstructionClientId[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.toLowerCase();
    let normalized: SkillInstructionClientId | null = null;
    if (id === "pi") {
      normalized = "pi";
    } else if ((CLIENTS as string[]).includes(id)) {
      const client = id as ClientId;
      normalized = client === "claude-code-cli" ? "claude-code" : client;
    }
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function resolveSkillsClientArg(
  client: string,
  installsMcp = false,
): SkillInstructionClientId[] {
  if (installsMcp)
    return normalizeSkillInstructionClientIds(resolveClients(client));
  const values = client.split(",").flatMap((raw) => {
    const id = raw.trim().toLowerCase();
    if (!id) return [];
    if (id === "all") return SKILL_INSTRUCTION_CLIENTS;
    if (id === "pi") return ["pi" as const];
    return resolveClients(id);
  });
  return normalizeSkillInstructionClientIds(values);
}

function skillsClients(installsMcp: boolean): SkillInstructionClientId[] {
  return installsMcp ? SKILLS_CLIENTS : SKILL_INSTRUCTION_PROMPT_CLIENTS;
}

function filterSkillsClients(
  clients: SkillInstructionClientId[],
  installsMcp: boolean,
): SkillInstructionClientId[] {
  if (installsMcp) {
    return clients.filter(
      (client): client is ClientId =>
        isMcpClientId(client) && SKILLS_CLIENTS.includes(client),
    );
  }
  // Instructions/local-files mode: keep the first-class instruction writers, and
  // map shared-`.agents` readers (cursor/opencode/github-copilot/cowork) onto
  // the shared-agents install (codex) so they install the skills they read
  // rather than being silently dropped to an empty set.
  const out: SkillInstructionClientId[] = [];
  for (const client of clients) {
    const resolved = SKILL_INSTRUCTION_CLIENTS.includes(client)
      ? client
      : SHARED_AGENTS_READER_CLIENTS.has(client)
        ? "codex"
        : undefined;
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

function clientPromptOptions(
  installsMcp: boolean,
): SkillsClientPromptContext["options"] {
  return skillsClients(installsMcp).map((client) => ({
    value: client,
    label:
      installsMcp && isMcpClientId(client)
        ? CLIENT_LABELS[client]
        : SKILL_INSTRUCTION_CLIENT_LABELS[client],
    hint:
      installsMcp && isMcpClientId(client)
        ? CLIENT_HINTS[client]
        : SKILL_INSTRUCTION_CLIENT_HINTS[client],
  }));
}

const DEFAULT_PUBLIC_SKILLS_SOURCE = "BuilderIO/skills";
const PUBLIC_SKILL_TARGET_PREFIX = "public-skills:";

const BUILT_IN_SKILL_PROMPT_OPTIONS: SkillsTargetPromptContext["options"] = [
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
  {
    value: "assets",
    label: "assets",
    hint: BUILT_IN_APP_SKILLS.assets.manifest.description,
  },
  {
    value: "content",
    label: "content",
    hint: BUILT_IN_APP_SKILLS.content.manifest.description,
  },
  {
    value: "design-exploration",
    label: "design-exploration",
    hint: BUILT_IN_APP_SKILLS.design.manifest.description,
  },
  {
    value: "context-xray",
    label: "context-xray",
    hint: BUILT_IN_APP_SKILLS["context-xray"].manifest.description,
  },
];

const DEFAULT_SKILL_PROMPT_TARGETS = ["visual-plan", "visual-recap"];

function hiddenBuiltInSkillTargets(options: RunSkillsOptions): Set<string> {
  return new Set(
    (options.hiddenBuiltInSkillTargets ?? []).map((target) =>
      target.trim().toLowerCase(),
    ),
  );
}

function builtInSkillPromptOptions(
  options: RunSkillsOptions,
): SkillsTargetPromptContext["options"] {
  const hidden = hiddenBuiltInSkillTargets(options);
  return BUILT_IN_SKILL_PROMPT_OPTIONS.filter(
    (entry) => !hidden.has(entry.value),
  );
}

function publicSkillEntries(
  options: RunSkillsOptions,
): PublicSkillCatalogEntry[] {
  if (options.catalogMode !== "all") return [];
  const seen = new Set<string>();
  return (options.publicSkillEntries ?? [])
    .map((entry) => ({
      name: entry.name.trim().toLowerCase(),
      description: entry.description,
    }))
    .filter((entry) => {
      if (!entry.name || isKnownSkill(entry.name) || seen.has(entry.name)) {
        return false;
      }
      seen.add(entry.name);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function publicSkillNames(options: RunSkillsOptions): Set<string> {
  return new Set(publicSkillEntries(options).map((entry) => entry.name));
}

function publicSkillPromptOptions(
  options: RunSkillsOptions,
): SkillsTargetPromptContext["options"] {
  return publicSkillEntries(options).map((entry) => ({
    value: entry.name,
    label: entry.name,
    hint:
      entry.description ?? "Public skill from the BuilderIO skills catalog.",
  }));
}

function skillPromptOptions(
  options: RunSkillsOptions = {},
): SkillsTargetPromptContext["options"] {
  return [
    ...builtInSkillPromptOptions(options),
    ...publicSkillPromptOptions(options),
  ];
}

function defaultSkillPromptTargets(options: RunSkillsOptions): string[] {
  const available = new Set(
    skillPromptOptions(options).map((entry) => entry.value),
  );
  return DEFAULT_SKILL_PROMPT_TARGETS.filter((target) => available.has(target));
}

function publicSkillSelectionTarget(skillNames: string[]): string {
  return `${PUBLIC_SKILL_TARGET_PREFIX}${skillNames.join(",")}`;
}

function publicSkillSelectionNames(target: string): string[] | null {
  if (!target.startsWith(PUBLIC_SKILL_TARGET_PREFIX)) return null;
  return target
    .slice(PUBLIC_SKILL_TARGET_PREFIX.length)
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function prVisualRecapWorkflowPath(baseDir: string): string {
  return path.join(baseDir, ".github", "workflows", "pr-visual-recap.yml");
}

function prVisualRecapWorkflowDisplayPath(): string {
  return path.join(".github", "workflows", "pr-visual-recap.yml");
}

const PR_VISUAL_RECAP_DOCS_URL =
  "https://www.agent-native.com/docs/pr-visual-recap";

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
      `  Learn more: ${PR_VISUAL_RECAP_DOCS_URL}\n` +
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
): Promise<SkillInstructionClientId[] | null> {
  const clack = await import("@clack/prompts");
  const message = context.installsMcp
    ? "Install the MCP connector for which clients?\n" +
      "  (space toggles, enter confirms; saved for next time)"
    : "Where should the skill instructions be written?\n" +
      "  (space toggles, enter confirms; saved for next time)";
  const result = await clack.multiselect({
    message,
    options: context.options,
    initialValues: context.initialClients,
    required: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return normalizeSkillInstructionClientIds(result);
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

async function promptForPlanMode(
  context: SkillsPlanModePromptContext,
): Promise<PlanInstallMode | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.select({
    message: "Where should visual plans and recaps live?",
    options: [
      {
        value: "hosted",
        label: "Hosted plans, shareable links (recommended)",
        hint: "100% free and open source. Supports comments, browser editor, and sharing. Requires one-time browser sign-in.",
      },
      {
        value: "local-files",
        label: "Local files only",
        hint: "Writes local MDX, starts a localhost bridge, and opens the hosted Plan UI. No sharing, all local.",
      },
      {
        value: "self-hosted",
        label: "Self-hosted/custom URL",
        hint: "Connect to your own Plan app or local dev tunnel.",
      },
    ],
    initialValue: context.initialMode,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return normalizePlanInstallMode(String(result));
}

async function promptForPlanMcpUrl(): Promise<string | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.text({
    message: "Plan app URL or MCP URL",
    placeholder: "https://my-plan-app.example.com",
    validate(value) {
      try {
        resolveMcpUrlOverride(value);
        return undefined;
      } catch (err: any) {
        return err?.message ?? "Enter a valid http:// or https:// URL.";
      }
    },
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return String(result).trim();
}

async function promptForUpdateInstructions(): Promise<boolean | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.confirm({
    message:
      "Add managed AGENTS.md / CLAUDE.md instructions for always-on skill behavior?",
    initialValue: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Skipped managed instruction updates.");
    return null;
  }
  return Boolean(result);
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
  installsMcp: boolean,
): Promise<SkillInstructionClientId[] | null> {
  if (parsed.clientExplicit || !shouldPrompt(parsed, options)) {
    const clients = filterSkillsClients(
      resolveSkillsClientArg(parsed.client, installsMcp),
      installsMcp,
    );
    if (clients.length === 0) {
      throw new Error(
        installsMcp
          ? "MCP setup supports Claude Code, Codex, Claude Cowork, Cursor, OpenCode, or GitHub Copilot / VS Code clients. Use --mode local-files or --no-mcp for Pi."
          : "Skill instructions use shared .agents for Codex, Pi, Cursor, OpenCode, Copilot, and similar agents, or Claude Code's native files.",
      );
    }
    return clients;
  }
  const initialClients = skillsClients(installsMcp);
  const prompt = options.promptClients ?? promptForClients;
  const selected = normalizeSkillInstructionClientIds(
    await prompt({
      initialClients,
      options: clientPromptOptions(installsMcp),
      installsMcp,
    }),
  );
  if (selected.length === 0) return null;
  if (!parsed.dryRun) {
    try {
      writeConnectClientPreferences(selected.filter(isMcpClientId));
    } catch {}
  }
  return selected;
}

function normalizePlanInstallMode(value: string | undefined): PlanInstallMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "hosted") return "hosted";
  if (
    normalized === "local" ||
    normalized === "local-file" ||
    normalized === "local-files" ||
    normalized === "files"
  ) {
    return "local-files";
  }
  if (
    normalized === "self-hosted" ||
    normalized === "selfhosted" ||
    normalized === "custom" ||
    normalized === "custom-url"
  ) {
    return "self-hosted";
  }
  throw new Error(
    '--mode must be one of "hosted", "local-files", or "self-hosted".',
  );
}

function targetIncludesPlans(target: string): boolean {
  return normalizeKnownSkillTarget(target) === "visual-plans";
}

function targetsIncludePlans(targets: string[]): boolean {
  return targets.some(targetIncludesPlans);
}

function targetIncludesInstallModeSkill(target: string): boolean {
  return targetSupportsInstallMode(normalizeKnownSkillTarget(target));
}

function targetsIncludeInstallModeSkills(targets: string[]): boolean {
  return targets.some(targetIncludesInstallModeSkill);
}

function planSkillNamesSelected(skillNames: string[] | undefined): boolean {
  return Boolean(
    skillNames?.some(
      (name) => normalizeKnownSkillTarget(name) === "visual-plans",
    ),
  );
}

function installModeSkillNamesSelected(
  skillNames: string[] | undefined,
): boolean {
  return Boolean(
    skillNames?.some((name) =>
      targetSupportsInstallMode(normalizeKnownSkillTarget(name)),
    ),
  );
}

function shouldForwardPlanModeFlag(
  target: string,
  skillNames: string[] | undefined,
): boolean {
  return (
    targetIncludesInstallModeSkill(target) ||
    installModeSkillNamesSelected(skillNames)
  );
}

function recapSkillNamesSelected(skillNames: string[] | undefined): boolean {
  return Boolean(
    skillNames?.some((name) => {
      const normalized = name.trim().toLowerCase();
      return (
        normalized === "visual-recap" ||
        normalized === "visual-recaps" ||
        normalizeKnownSkillTarget(normalized) === "visual-plans"
      );
    }),
  );
}

function resolveSelectedSkillTargets(
  selected: string[],
  options: RunSkillsOptions,
): string[] {
  const publicNames = publicSkillNames(options);
  const builtInSelections: string[] = [];
  const publicSelections: string[] = [];

  for (const raw of selected) {
    const skill = raw.trim().toLowerCase();
    if (!skill) continue;
    if (isKnownSkill(skill)) {
      builtInSelections.push(skill);
      continue;
    }
    if (publicNames.has(skill)) {
      publicSelections.push(skill);
      continue;
    }
    throw new Error(
      `Unknown skill: ${raw}. Run "npx @agent-native/core@latest skills list".`,
    );
  }

  const out: string[] = [];
  const planSubskills = ["visual-plan", "visual-recap"];
  const selectedPlanSubskills = planSubskills.filter((skill) =>
    builtInSelections.includes(skill),
  );
  if (selectedPlanSubskills.length === planSubskills.length) {
    out.push("visual-plans");
  } else {
    out.push(...selectedPlanSubskills);
  }
  out.push(
    ...builtInSelections.filter(
      (skill) => !planSubskills.includes(skill) && !out.includes(skill),
    ),
  );
  if (publicSelections.length > 0) {
    out.push(publicSkillSelectionTarget([...new Set(publicSelections)]));
  }
  return out;
}

async function resolveSkillTargets(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
): Promise<string[] | null> {
  if (!parsed.target && parsed.plainSkillNames?.length) {
    return resolveSelectedSkillTargets(parsed.plainSkillNames, options);
  }
  if (parsed.target || !shouldPrompt(parsed, options)) {
    const target = parsed.target ?? "assets";
    if (!parsed.target) return [target];
    const normalizedTarget = target.trim().toLowerCase();
    if (publicSkillNames(options).has(normalizedTarget)) {
      return [publicSkillSelectionTarget([normalizedTarget])];
    }
    return [target];
  }
  const prompt = options.promptSkills ?? promptForSkills;
  const promptOptions = skillPromptOptions(options);
  // The interactive multiselect skill picker is about to be shown (no --skill /
  // target passed and we are interactive) — record the funnel "prompted" step.
  options.telemetry?.track("skills_cli skills prompted", {
    availableCount: promptOptions.length,
    available: promptOptions.map((option) => option.value).join(","),
  });
  const selected = await prompt({
    initialTargets: defaultSkillPromptTargets(options),
    options: promptOptions,
  });
  if (!selected || selected.length === 0) return null;
  return resolveSelectedSkillTargets(selected, options);
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
    } else if ((value = eat("--agent")) !== undefined) {
      out.client = value;
      out.clientExplicit = true;
    } else if ((value = eat("-a")) !== undefined) {
      out.client = value;
      out.clientExplicit = true;
    } else if ((value = eat("--skill")) !== undefined) {
      out.plainSkillNames = [...(out.plainSkillNames ?? []), value];
    } else if ((value = eat("-s")) !== undefined) {
      out.plainSkillNames = [...(out.plainSkillNames ?? []), value];
    } else if ((value = eat("--scope")) !== undefined) {
      out.scope = value;
      out.scopeExplicit = true;
    } else if ((value = eat("--cwd")) !== undefined) out.baseDir = value;
    else if ((value = eat("--mcp-url")) !== undefined) out.mcpUrl = value;
    else if ((value = eat("--mode")) !== undefined)
      out.planMode = normalizePlanInstallMode(value);
    else if (arg === "--hosted") out.planMode = "hosted";
    else if (arg === "--local" || arg === "--local-files")
      out.planMode = "local-files";
    else if (arg === "--self-hosted" || arg === "--custom-url")
      out.planMode = "self-hosted";
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.printJson = true;
    else if (arg === "-g" || arg === "--global") {
      out.scope = "user";
      out.scopeExplicit = true;
    } else if (arg === "--project") {
      out.scope = "project";
      out.scopeExplicit = true;
    } else if (arg === "--copy") {
      // Compatibility with @agent-native/skills. Core always copies skill
      // instructions instead of linking to the source repo.
    } else if (arg === "--mcp-only") out.instructions = false;
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
  if (out.planMode === "local-files" && out.mcpUrl) {
    throw new Error("--mode local-files cannot be combined with --mcp-url.");
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
      modeAwareId: targetSupportsInstallMode(knownTarget)
        ? knownTarget
        : undefined,
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
    modeAwareId: targetSupportsInstallMode(loaded.manifest.id)
      ? loaded.manifest.id
      : undefined,
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

function skillsAgentsForClients(
  clients: SkillInstructionClientId[],
): SkillInstructionClientId[] {
  const agents = new Set<SkillInstructionClientId>();
  for (const client of clients) {
    if (client === "codex") agents.add("codex");
    if (client === "claude-code" || client === "claude-code-cli") {
      agents.add("claude-code");
    }
    if (client === "pi") agents.add("pi");
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

function clientArgForClients(clients: SkillInstructionClientId[]): string {
  if (clients.length === CLIENTS.length && clients.every(isMcpClientId))
    return "all";
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
  options: { modeAwareTargetId?: string } = {},
): string {
  const clients =
    parsed.clients ??
    resolveSkillsClientArg(parsed.client, targetInstallsMcp(target, parsed));
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
  const forwardsPlanFlags = shouldForwardPlanModeFlag(
    target,
    parsed.plainSkillNames,
  );
  const forwardsInstallMode =
    forwardsPlanFlags || targetSupportsInstallMode(options.modeAwareTargetId);
  if (forwardsInstallMode && parsed.planMode)
    args.push("--mode", parsed.planMode);
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
  clients: SkillInstructionClientId[],
  baseDir: string | undefined,
): string[] {
  const args = [
    "--yes",
    "@agent-native/skills@latest",
    "add",
    "--quiet",
    "--copy",
    target,
    "--client",
    clientArgForClients(clients),
    "--scope",
    parsed.scope,
  ];
  if (baseDir) args.push("--cwd", baseDir);
  if (parsed.withGithubAction) args.push("--with-github-action");
  if (parsed.force) args.push("--force");
  const forwardsPlanFlags = shouldForwardPlanModeFlag(
    target,
    parsed.plainSkillNames,
  );
  if (forwardsPlanFlags && parsed.planMode)
    args.push("--mode", parsed.planMode);
  if (forwardsPlanFlags && parsed.mcpUrl) args.push("--mcp-url", parsed.mcpUrl);
  if (!parsed.mcp) args.push("--no-mcp");
  if (!parsed.connect) args.push("--no-connect");
  for (const skill of parsed.plainSkillNames ?? []) {
    args.push("--skill", skill);
  }
  if (parsed.updateInstructions === true) args.push("--update-instructions");
  if (parsed.updateInstructions === false)
    args.push("--no-update-instructions");
  if (parsed.yes) args.push("--yes");
  if (parsed.dryRun) args.push("--dry-run");
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
  if (parsed.mcpUrl && !installModeSkillNamesSelected(parsed.plainSkillNames)) {
    throw new Error(
      "--mcp-url only applies to app-backed Agent Native skills.",
    );
  }

  const clients = parsed.clients ?? resolveSkillsClientArg(parsed.client);
  const skillsAgents = skillsAgentsForClients(clients);
  const selectedSkillNames = parsed.plainSkillNames ?? [];
  if (skillsAgents.length === 0) {
    throw new Error(
      "Plain skill repositories install through shared .agents for Codex, Pi, Cursor, OpenCode, Copilot, and similar agents, or Claude Code's native files.",
    );
  }
  const args = agentNativeSkillsInstallArgs(
    parsed,
    target,
    skillsAgents,
    options.baseDir,
  );
  if (!parsed.dryRun) {
    const code = await (options.runCommand ?? runCommand)("npx", args, {
      stdio: "silent",
    });
    if (code !== 0)
      throw new Error(
        `npx @agent-native/skills@latest add exited with ${code}.`,
      );
  }
  options.telemetry?.track("skills_cli install completed", {
    skills: selectedSkillNames.length ? selectedSkillNames.join(",") : target,
    clients: clients.join(","),
    scope: parsed.scope,
    dryRun: Boolean(parsed.dryRun),
  });
  return {
    id: target,
    displayName: selectedSkillNames.length
      ? selectedSkillNames.join(", ")
      : target,
    skillNames: selectedSkillNames,
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

function normalizeConnectLogMessage(message: string): string {
  return message
    .split("\n")
    .map((line) => (line.startsWith("  ") ? line.slice(2) : line))
    .join("\n");
}

function createClackConnectLog(
  clack: typeof import("@clack/prompts"),
): (message: string) => void {
  return (message) => {
    clack.log.message(normalizeConnectLogMessage(message), {
      symbol: clack.S_BAR,
      secondarySymbol: clack.S_BAR,
      spacing: 0,
    });
  };
}

async function runWithConnectSpinner<T>(
  options: RunSkillsOptions,
  message: string,
  task: () => T | Promise<T>,
): Promise<T> {
  const spinner = options.createConnectSpinner?.();
  if (!spinner) return await task();
  spinner.start(message);
  try {
    return await task();
  } finally {
    spinner.clear();
  }
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

  const authMessage = `Authenticating ${installTarget.displayName}…`;
  const connectLog = options.connectLog ?? options.log;
  const spinner = options.createConnectSpinner?.();
  let spinnerActive = false;
  let wroteAuthMessage = false;
  const clearSpinner = () => {
    if (!spinnerActive) return;
    spinner.clear();
    spinnerActive = false;
  };
  const writeAuthMessage = () => {
    if (wroteAuthMessage) return;
    connectLog?.(authMessage);
    wroteAuthMessage = true;
  };
  const writeConnectLog = (message: string) => {
    clearSpinner();
    writeAuthMessage();
    connectLog?.(message);
  };
  if (spinner) {
    spinner.start(authMessage);
    spinnerActive = true;
  } else {
    writeAuthMessage();
  }
  options.telemetry?.track("skills_cli connect started");
  try {
    const connectArgs = [
      hostedUrl,
      "--client",
      clientArgForClients(clients),
      "--scope",
      parsed.scope,
    ];
    if (options.runConnect) {
      await options.runConnect(connectArgs);
    } else {
      await runConnect(connectArgs, {
        isInteractive: options.isInteractive,
        logOut: writeConnectLog,
        logErr: writeConnectLog,
        withBrowserOpenSpinner: (message, openBrowser) =>
          runWithConnectSpinner(options, message, openBrowser),
      });
    }
    clearSpinner();
    writeAuthMessage();
    options.telemetry?.track("skills_cli connect completed");
    return { connected: true, connectCommand: "" };
  } catch (err: any) {
    clearSpinner();
    writeAuthMessage();
    // Non-fatal: the MCP connector is registered. Surface the manual command.
    options.telemetry?.track("skills_cli connect failed", {
      error: err?.message ?? String(err),
    });
    connectLog?.(
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
  const publicSelection = publicSkillSelectionNames(target);
  if (publicSelection) {
    return addPlainSkillRepo(
      {
        ...parsed,
        target: options.publicSkillSource ?? DEFAULT_PUBLIC_SKILLS_SOURCE,
        plainSkillNames: publicSelection,
      },
      options,
    );
  }
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
  const baseDir = options.baseDir ?? process.cwd();
  if (isLocalOnlyBuiltInSkill(knownBuiltIn)) {
    if (parsed.planMode) {
      throw new Error(
        "--mode only applies to visual-plan / visual-recap / content.",
      );
    }
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
    const clients = (
      parsed.clients ?? resolveSkillsClientArg(parsed.client)
    ).filter(isMcpClientId);
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
      baseDir,
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
  const modeAwareTargetId = installTarget.modeAwareId;
  const planMode = modeAwareTargetId
    ? (parsed.planMode ??
      (parsed.mcpUrl
        ? "self-hosted"
        : modeAwareTargetId === "visual-plans"
          ? "hosted"
          : undefined))
    : undefined;
  if (parsed.planMode && !modeAwareTargetId) {
    throw new Error(
      "--mode only applies to visual-plan / visual-recap / content.",
    );
  }
  if (planMode === "local-files" && parsed.mcpUrl) {
    throw new Error("--mode local-files cannot be combined with --mcp-url.");
  }
  if (planMode === "self-hosted" && !parsed.mcpUrl) {
    throw new Error("--mode self-hosted requires --mcp-url <url>.");
  }
  const shouldRegisterMcp =
    parsed.mcp && !localFilesModeSkipsMcp(modeAwareTargetId, planMode);
  if (parsed.mcpUrl) {
    installTarget = withMcpUrlOverride(installTarget, parsed.mcpUrl);
  }
  const clients =
    parsed.clients ?? resolveSkillsClientArg(parsed.client, shouldRegisterMcp);
  const mcpClients = clients.filter(isMcpClientId);
  if (shouldRegisterMcp && mcpClients.length === 0) {
    throw new Error(
      "MCP setup supports Claude Code, Codex, Claude Cowork, Cursor, OpenCode, or GitHub Copilot / VS Code clients. Use --mode local-files or --no-mcp for Pi.",
    );
  }
  installTarget = preserveMcpUrlAppPathOverride(installTarget, parsed.mcpUrl);
  const skillsAgents = skillsAgentsForClients(clients);
  if (parsed.dryRun) {
    try {
      const localManifestPath = shouldWriteContentLocalFilesManifest(
        modeAwareTargetId,
        planMode,
      )
        ? contentLocalFilesManifestPath(baseDir)
        : undefined;
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
        mcpUrl: localFilesModeSkipsMcp(modeAwareTargetId, planMode)
          ? ""
          : installTarget.loaded.manifest.hosted.mcpUrl,
        mcpClients: shouldRegisterMcp ? mcpClients : [],
        dryRun: true,
        commands: [
          dryRunInstallCommand(parsed, target, { modeAwareTargetId }),
          ...(localManifestPath ? [`write ${localManifestPath}`] : []),
        ],
        githubActionPath,
        githubActionSuggestedCommand,
        planMode,
        localManifestPath,
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
  let registeredMcpClients: ClientId[] = shouldRegisterMcp ? mcpClients : [];
  let localManifestPath: string | undefined;

  try {
    if (parsed.instructions) {
      if (skillsAgents.length === 0) {
        if (!shouldRegisterMcp) {
          throw new Error(
            "Skill instructions use shared .agents for Codex, Pi, Cursor, OpenCode, Copilot, and similar agents, or Claude Code's native files. Use an MCP-capable client or omit --instructions-only.",
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
          baseDir,
          dryRun: parsed.dryRun,
          planMode,
          mcpUrl: installTarget.loaded.manifest.hosted.mcpUrl,
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
          "--quiet",
          instructionSource,
          "--copy",
          ...installTarget.skillNames.flatMap((skill) => ["--skill", skill]),
          ...skillsAgents.flatMap((agent) => ["-a", agent]),
          ...(parsed.scope === "user" ? ["-g"] : []),
          ...(modeAwareTargetId && parsed.planMode
            ? ["--mode", parsed.planMode]
            : []),
          ...(modeAwareTargetId && parsed.mcpUrl
            ? ["--mcp-url", parsed.mcpUrl]
            : []),
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

    if (shouldWriteContentLocalFilesManifest(modeAwareTargetId, planMode)) {
      localManifestPath = writeContentLocalFilesManifest(baseDir);
      commands.push(`write ${localManifestPath}`);
    }

    // Skill instructions are now on disk (built-in folders copied or external
    // pack materialized) — record the install before MCP registration/connect.
    options.telemetry?.track("skills_cli install completed", {
      skills: installTarget.skillNames.join(","),
      clients: clients.join(","),
      scope: parsed.scope,
      dryRun: Boolean(parsed.dryRun),
    });

    if (shouldRegisterMcp) {
      commands.push(
        `npx @agent-native/core@latest app-skill ensure --manifest ${installTarget.loaded.file} --client ${parsed.client} --scope ${parsed.scope} --yes`,
      );
      if (!parsed.dryRun) {
        const ensureResult = await ensureAppSkill(installTarget.loaded, {
          clients: mcpClients,
          scope: parsed.scope,
          baseDir: options.baseDir,
          yes: parsed.yes || Boolean(knownTarget),
          confirm: true,
          log: options.log,
        });
        registeredMcpClients = ensureResult.written.map(
          (written) => written.client,
        );
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
            mcpClients,
            parsed,
            options,
          );
          connected = result.connected;
          connectCommand = result.connectCommand || undefined;
          if (connected) registeredMcpClients = mcpClients;
          if (connectCommand) commands.push(connectCommand);
        } else {
          const pendingClients = mcpClients.filter(
            (client) => !registeredMcpClients.includes(client),
          );
          if (pendingClients.length > 0) {
            connectCommand = connectCommandFor(
              installTarget.loaded.manifest.hosted.url,
              pendingClients,
              parsed.scope,
            );
            commands.push(connectCommand);
          }
        }
      }
    }

    // `--with-github-action`: also drop the PR Visual Recap workflow into the
    // repo so PRs get automatic recaps. Only meaningful for the plan family.
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
          docsUrl: PR_VISUAL_RECAP_DOCS_URL,
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
      mcpUrl: localFilesModeSkipsMcp(modeAwareTargetId, planMode)
        ? ""
        : installTarget.loaded.manifest.hosted.mcpUrl,
      mcpClients: registeredMcpClients,
      dryRun: parsed.dryRun,
      commands,
      written: instructionsWritten,
      connected,
      connectCommand,
      planMode,
      localManifestPath,
      githubActionPath,
      githubActionExisted,
      githubActionSuggestedCommand,
    };
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    installTarget.cleanup?.();
  }
}

function listSkills(options: RunSkillsOptions = {}) {
  const hidden = hiddenBuiltInSkillTargets(options);
  return [
    ...Object.values(BUILT_IN_APP_SKILLS)
      .filter((entry) => !hidden.has(entry.skillName))
      .map((entry) => ({
        id: entry.manifest.id,
        aliases:
          BUILT_IN_APP_SKILL_DISPLAY_ALIASES[
            entry.manifest.id as BuiltInAppSkillId
          ] ?? [],
        name: entry.manifest.displayName,
        description: entry.manifest.description,
        mcpUrl: isLocalOnlyBuiltInSkill(entry)
          ? ""
          : entry.manifest.hosted.mcpUrl,
        local: isLocalOnlyBuiltInSkill(entry),
        source: "agent-native",
      })),
    ...publicSkillEntries(options).map((entry) => ({
      id: entry.name,
      aliases: [] as string[],
      name: entry.name,
      description:
        entry.description ?? "Public skill from the BuilderIO skills catalog.",
      mcpUrl: "",
      local: true,
      source: options.publicSkillSource ?? DEFAULT_PUBLIC_SKILLS_SOURCE,
    })),
  ];
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
    planMode: state.planMode,
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

function scaffoldStateJson(state: ScaffoldGuidanceState) {
  return {
    kind: state.kind,
    displayName: state.displayName,
    templateName: state.templateName,
    path: state.path,
    sourcePath: state.sourcePath,
    projectRoot: state.projectRoot,
    workspaceRoot: state.workspaceRoot,
    sharedPackageDir: state.sharedPackageDir,
    skillCount: state.skillCount,
    status: state.current ? "current" : "stale",
    managed: true,
  };
}

function formatScaffoldState(state: ScaffoldGuidanceState): string {
  const status = state.current ? "current" : "stale";
  return `${"scaffold".padEnd(22)} ${status.padEnd(7)} project/${state.kind} managed (${state.skillCount} skills)\n  ${state.path}`;
}

function planModeSummary(mode: PlanInstallMode): string {
  if (mode === "local-files")
    return "Local files - no hosted writes by default";
  if (mode === "self-hosted") return "Self-hosted/custom app";
  return "Hosted app";
}

function skillInstructionAgentLabel(agent: string): string {
  if (agent === "codex") return SKILL_INSTRUCTION_CLIENT_LABELS.codex;
  if (agent === "claude-code")
    return SKILL_INSTRUCTION_CLIENT_LABELS["claude-code"];
  if (agent === "pi") return SKILL_INSTRUCTION_CLIENT_LABELS.pi;
  return agent;
}

function targetInstallsMcp(
  target: string,
  parsed: Pick<ParsedSkillsArgs, "mcp" | "planMode">,
): boolean {
  if (!parsed.mcp) return false;
  if (publicSkillSelectionNames(target)) return false;
  const knownTarget = normalizeKnownSkillTarget(target);
  if (localFilesModeSkipsMcp(knownTarget, parsed.planMode)) return false;
  if (knownTarget) {
    return !isLocalOnlyBuiltInSkill(BUILT_IN_APP_SKILLS[knownTarget]);
  }
  return true;
}

function targetsInstallMcp(
  targets: string[],
  parsed: ParsedSkillsArgs,
): boolean {
  return targets.some((target) => targetInstallsMcp(target, parsed));
}

function instructionContentForSkill(skillName: string): string | null {
  if (skillName === "quick-recap") {
    return "When writing final response status indicators, use the /quick-recap skill always.";
  }
  if (skillName === "efficient-fable") {
    return "When operating as Claude Fable, use the /efficient-fable skill always.";
  }
  if (skillName === "efficient-frontier") {
    return "When using a high-cost frontier model for codebase-heavy work, use the /efficient-frontier skill always.";
  }
  if (skillName === "stay-within-limits") {
    return "When long-running or parallel work needs usage-limit checks, use the /stay-within-limits skill always.";
  }
  if (skillName === "visual-plan") {
    return "When work needs an interactive visual plan before implementation, use the /visual-plan skill always.";
  }
  if (skillName === "visual-recap") {
    return "When a PR, branch, commit, or diff needs an interactive visual recap, use the /visual-recap skill always.";
  }
  return null;
}

function selectedPlainSkillNamesForInstructionPrompt(
  targets: string[],
  parsed: ParsedSkillsArgs,
): string[] {
  const names = new Set<string>(parsed.plainSkillNames ?? []);
  for (const target of targets) {
    for (const name of publicSkillSelectionNames(target) ?? []) {
      names.add(name);
    }
  }
  return [...names];
}

function hasManagedInstructionBlock(skillNames: string[]): boolean {
  return skillNames.some((name) => Boolean(instructionContentForSkill(name)));
}

function runSkillsStatusOrUpdate(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions,
  update: boolean,
): void {
  const skillBefore = collectSkillInstallStates(parsed, options);
  const scaffoldBefore = collectScaffoldGuidanceStates(parsed, options);
  const skillChanged = update
    ? updateSkillInstallStates(skillBefore, parsed.dryRun)
    : [];
  const scaffoldChanged = update
    ? updateScaffoldGuidanceStates(scaffoldBefore, parsed.dryRun)
    : [];
  if (update && !parsed.dryRun && scaffoldChanged.length > 0) {
    repairScaffoldAgentLinks(scaffoldChanged);
  }
  const skillAfter =
    update && !parsed.dryRun
      ? collectSkillInstallStates(parsed, options)
      : skillBefore;
  const scaffoldAfter =
    update && !parsed.dryRun
      ? collectScaffoldGuidanceStates(parsed, options)
      : scaffoldBefore;
  const beforeCount = skillBefore.length + scaffoldBefore.length;
  const changedCount = skillChanged.length + scaffoldChanged.length;

  if (parsed.printJson) {
    const outputSkillStates =
      update && !parsed.dryRun ? skillAfter : skillBefore;
    const outputScaffoldStates =
      update && !parsed.dryRun ? scaffoldAfter : scaffoldBefore;
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          command: parsed.command,
          dryRun: parsed.dryRun,
          found: beforeCount,
          stale:
            outputSkillStates.filter((state) => !state.current).length +
            outputScaffoldStates.filter((state) => !state.current).length,
          updated: changedCount,
          skills: outputSkillStates.map(skillStateJson),
          scaffold: outputScaffoldStates.map(scaffoldStateJson),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  if (beforeCount === 0) {
    const target = parsed.target ? ` for ${parsed.target}` : "";
    const hint = isScaffoldGuidanceTarget(parsed.target)
      ? `Run this from a generated Agent Native app or workspace root.\n`
      : `Run "npx @agent-native/core@latest skills add ${parsed.target ?? "visual-plan"}" to install one.\n`;
    process.stdout.write(
      `No installed Agent Native skill copies found${target}.\n${hint}`,
    );
    return;
  }

  if (update) {
    if (parsed.dryRun) {
      process.stdout.write(
        changedCount
          ? `Would update ${changedCount} skill folder${changedCount === 1 ? "" : "s"}:\n`
          : "All discovered skill folders are already current.\n",
      );
    } else {
      process.stdout.write(
        changedCount
          ? `Updated ${changedCount} skill folder${changedCount === 1 ? "" : "s"}.\n`
          : "All discovered skill folders are already current.\n",
      );
    }
  }

  const rows = [
    ...(update && parsed.dryRun ? skillBefore : skillAfter).map(
      formatSkillState,
    ),
    ...(update && parsed.dryRun ? scaffoldBefore : scaffoldAfter).map(
      formatScaffoldState,
    ),
  ];
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
  if (parsed.baseDir) {
    options = { ...options, baseDir: path.resolve(parsed.baseDir) };
  }
  const clackForLog = parsed.printJson
    ? undefined
    : await import("@clack/prompts");
  const log = parsed.printJson
    ? undefined
    : (message: string) => {
        if (!message.trim()) return;
        clackForLog?.log.info(message);
      };
  const connectLog =
    !parsed.printJson && clackForLog
      ? createClackConnectLog(clackForLog)
      : undefined;
  const createConnectSpinner =
    !parsed.printJson && clackForLog && process.stdout.isTTY
      ? () => clackForLog.spinner({ indicator: "timer" })
      : undefined;

  if (parsed.command === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  // `@agent-native/skills` now delegates its interactive install to this
  // function. For plain skill repos we still shell out to
  // `npx @agent-native/skills@latest add …`; this env guard tells that child process
  // to run its OWN headless installer instead of bouncing back into core,
  // which would otherwise be an infinite skills → core → skills loop.
  const previousDirect = process.env.AGENT_NATIVE_SKILLS_DIRECT;
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
  const optionsWithTelemetry: RunSkillsOptions = {
    ...options,
    telemetry,
    connectLog: options.connectLog ?? connectLog,
    createConnectSpinner: options.createConnectSpinner ?? createConnectSpinner,
  };

  try {
    telemetry.track("skills_cli started");

    if (parsed.command === "list") {
      const skills = listSkills(optionsWithTelemetry);
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
      selectedAll: targets.length === skillPromptOptions(options).length,
      preselected,
    });

    const includesPlans =
      targetsIncludePlans(targets) ||
      planSkillNamesSelected(parsed.plainSkillNames);
    const includesInstallModeSkills =
      targetsIncludeInstallModeSkills(targets) ||
      installModeSkillNamesSelected(parsed.plainSkillNames);
    if (parsed.planMode && !includesInstallModeSkills) {
      throw new Error(
        "--mode only applies to visual-plan / visual-recap / content.",
      );
    }
    if (includesPlans) {
      if (!parsed.planMode && parsed.mcpUrl) {
        parsed.planMode = "self-hosted";
      }
      if (!parsed.planMode && shouldPrompt(parsed, options)) {
        const prompt = options.promptPlanMode ?? promptForPlanMode;
        const mode = await prompt({ initialMode: "hosted" });
        if (!mode) {
          telemetry.track("skills_cli cancelled", { step: "plan-mode" });
          return;
        }
        parsed.planMode = mode;
      }
      if (!parsed.planMode) parsed.planMode = "hosted";
      if (parsed.planMode === "self-hosted" && !parsed.mcpUrl) {
        if (shouldPrompt(parsed, options)) {
          const prompt = options.promptPlanMcpUrl ?? promptForPlanMcpUrl;
          const mcpUrl = await prompt();
          if (!mcpUrl) {
            telemetry.track("skills_cli cancelled", {
              step: "plan-mcp-url",
            });
            return;
          }
          parsed.mcpUrl = mcpUrl;
        } else {
          throw new Error(
            "--mode self-hosted requires --mcp-url <url> in non-interactive mode.",
          );
        }
      }
      telemetry.track("skills_cli plan mode selected", {
        mode: parsed.planMode,
      });
    }

    const installsMcp = targetsInstallMcp(targets, parsed);
    const clients = await resolveSkillsClients(
      parsed,
      optionsWithTelemetry,
      installsMcp,
    );
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

    const instructionSkillNames = selectedPlainSkillNamesForInstructionPrompt(
      targets,
      parsed,
    );
    if (
      parsed.updateInstructions === undefined &&
      hasManagedInstructionBlock(instructionSkillNames) &&
      shouldPrompt(parsed, options)
    ) {
      const prompt =
        options.promptUpdateInstructions ?? promptForUpdateInstructions;
      const choice = await prompt();
      if (choice === null) {
        telemetry.track("skills_cli cancelled", {
          step: "managed-instructions",
        });
        return;
      }
      parsed.updateInstructions = choice === true;
    }

    // Decide the optional PR Visual Recap GitHub Action UP FRONT — before any
    // install or MCP registration — so every prompt is answered before we touch
    // disk. The choice is threaded into each install via `withGithubAction` +
    // `githubActionResolved` (so addAgentNativeSkill doesn't re-prompt mid-flow).
    const recapBaseDir = options.baseDir ?? process.cwd();
    const anyRecapTarget =
      targets.some((target) => {
        if (normalizeKnownSkillTarget(target) !== "visual-plans") return false;
        const only = builtInOnlySkillNames(target);
        return !only || only.includes("visual-recap");
      }) || recapSkillNamesSelected(parsed.plainSkillNames);
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
        docsUrl: PR_VISUAL_RECAP_DOCS_URL,
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
          .filter((result) => result.local && result.scriptPath)
          .flatMap((result) => result.commands),
      ),
    ];
    const planModes = [
      ...new Set(
        results
          .map((result) => result.planMode)
          .filter((mode): mode is PlanInstallMode => Boolean(mode)),
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
        ? `Skill instructions   ${skillsAgents.map(skillInstructionAgentLabel).join(", ")}`
        : "Skill instructions   skipped",
      mcpClients.length
        ? `MCP config           ${mcpClients.map((client) => CLIENT_LABELS[client]).join(", ")}`
        : "MCP config           not required",
      mcpUrls.length ? `MCP URL              ${mcpUrls.join(", ")}` : "",
      planModes.length
        ? `Install mode         ${planModes.map(planModeSummary).join(", ")}`
        : "",
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

    // OAuth clients (Claude Code) can finish auth in-host via /mcp, not only by
    // running the connect command — surface that on the no-connect/pending path
    // so a hosted install isn't left looking "done but unauthenticated".
    if (
      !authConnected &&
      mcpClients.some(
        (client) => client === "claude-code" || client === "claude-code-cli",
      )
    ) {
      clack.log.info(
        "Claude Code: reload the client, then open /mcp and choose Authenticate to finish connecting" +
          (pendingConnectCommands.length
            ? " (or run the connect command above)."
            : "."),
      );
    }

    // GitHub Action follow-ups — kept as exact, copy-pasteable command lines.
    for (const line of [githubActionLine, githubActionSuggestionLine].filter(
      Boolean,
    )) {
      clack.log.info(line);
    }

    const slashCommands = completedSkills.map((name) => `/${name}`).join("  ");
    const configuredEveryClient = SKILLS_CLIENTS.every((client) =>
      clients.includes(client),
    );
    const clientHint = configuredEveryClient
      ? ""
      : "\n   Add another client later with --client <client> (e.g. --client claude-code).";
    const reloadTarget = mcpClients.length > 0 ? "skill + MCP server" : "skill";
    clack.outro(
      `✅ All set! Start using ${slashCommands || "your new skills"} in your agent client.` +
        `\n   You may need to reload the client for the ${reloadTarget} to appear.` +
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
    if (previousDirect === undefined) {
      delete process.env.AGENT_NATIVE_SKILLS_DIRECT;
    } else {
      process.env.AGENT_NATIVE_SKILLS_DIRECT = previousDirect;
    }
  }
}
