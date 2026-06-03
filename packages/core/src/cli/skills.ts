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
  writeConnectClientPreferences,
} from "./connect.js";
import {
  CONTEXT_XRAY_SKILL_MD,
  installLocalContextXray,
} from "./context-xray-local.js";
import { CLIENTS, type ClientId } from "./mcp-config-writers.js";

const HELP = `agent-native skills

Usage:
  agent-native skills list
  agent-native skills add assets|design-exploration|visual-plans|context-xray [--client codex|claude-code|claude-code-cli|cowork|all] [--scope user|project] [--mcp-url <url>] [--yes] [--dry-run] [--json]
  agent-native skills add <manifest-or-app-dir> [--client ...] [--yes]

Examples:
  agent-native skills add assets
  agent-native skills add design-exploration
  agent-native skills add visual-plans
  agent-native skills add context-xray --client all
  agent-native skills add assets --client claude-code
  agent-native skills add assets --mcp-url https://my-app.ngrok-free.dev
  agent-native skills add ./dist/assets-skill --client codex

The add command wraps the Vercel Labs/open skills CLI for SKILL.md
installation, then registers the app-backed MCP connector. Running
"npx skills add ..." directly installs instructions only; use this Agent Native
CLI path when you want MCP setup too. Pass --mcp-url to register that connector
against a custom origin (an ngrok tunnel, a local dev server, or a self-hosted
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

const VISUAL_PLANS_SKILL_MD = `---
name: visual-plans
description: >-
  Use Visual Plans for coding-agent work that needs an interactive HTML plan,
  diagrams, wireframes, prototype options, annotations, implementation tasks,
  feedback, and proof gates through the hosted Visual Plans MCP app.
metadata:
  visibility: exported
---

# Visual Plans

Use Visual Plans as HTML plan mode for coding work. The point is not to create a
prettier Markdown plan. The point is to give the user something visual to react
to before the agent edits code: diagrams, wireframes, option cards, clickable
prototype sketches, assumptions, tasks, annotations, and proof gates.

Text is the fallback layer. Default to visual artifacts.

## When To Use

Create or update a visual plan when:

- the user asks for a plan, visual plan, HTML plan, plannotate-style review,
  diagrams, wireframes, mockups, prototype options, comments, or annotations;
- work is multi-file, ambiguous, long-running, risky, or UI-heavy;
- the user needs to react quickly to direction rather than read prose;
- the task touches auth, billing, migrations, public APIs, tests, production
  config, data, security, permissions, or deploy behavior;
- you would otherwise proceed on a material assumption;
- you are about to claim the work is complete and need proof gates checked.

Do not log every trivial inference. An assumption is material when changing it
would affect user-visible behavior, data model, permissions, billing, public API
shape, migrations/backfills/data loss, test strategy, architecture boundaries,
deployment/configuration, file scope, or the definition of done.

## Core Workflow

1. Call \`create-visual-plan\` with the goal, source, repo path, and initial
   plan nodes before implementation.
2. Surface the returned Visual Plans link or inline MCP App. In CLI hosts, tell
   the user to open the link and review the visual plan.
3. Prefer diagrams, wireframes, UI mockups, option cards, and small interactive
   prototypes over paragraphs.
4. Call \`get-plan-feedback\` before editing, after review, after any long pause,
   and before the final response.
5. If the user comments, accepts, rejects, corrects, or requests proof, consume
   the structured feedback and update the implementation plan accordingly.
6. If new facts require a change after approval, create an amendment or
   deviation with \`update-visual-plan\` instead of drifting silently.
7. Attach command/test/log/diff/screenshot/design artifacts with
   \`record-plan-evidence\`. Agent claims are not proof.
8. Export an HTML/JSON/Markdown receipt with \`export-visual-plan\` when the
   user wants a shareable summary.

## Visual Defaults

- UI work gets wireframes or prototype options before coding.
- Backend/refactor work gets architecture and data-flow diagrams.
- Complex tradeoffs get two or three option cards with consequences.
- Assumptions are shown as reviewable visual callouts, not hidden prose.
- Proof gates stay compact: what must pass, current evidence, and missing proof.
- Long prose is collapsed behind the visual plan.

## Tool Guidance

- \`create-visual-plan\`: start one visual plan per agent task/run.
- \`update-visual-plan\`: bulk add/update plan nodes, options, assumptions,
  decisions, tasks, risks, deviations, annotations, and proof gates.
- \`get-visual-plan\` and \`get-plan-review-queue\`: read current plan state.
- \`get-plan-feedback\`: read unconsumed human feedback. Use it frequently.
- \`record-plan-progress\`: update phase/status and mark feedback consumed only
  after you incorporated it.
- \`record-plan-evidence\`: attach artifacts and provenance. Use high trust for
  captured commands/tests/CI, human_confirmed for explicit human confirmation,
  and low trust for agent-only statements.
- \`analyze-visual-plan\`: import pasted Markdown/text and create possible
  visual plan nodes. Treat detections as possible, not authoritative.

## Guardrails

- Keep it simple. Do not build a ten-tab dashboard unless the user asks.
- Before high-risk actions, create a blocking review item or ask the user
  directly.
- Never modify tests merely to make implementation pass unless the visual plan
  explicitly approves test expectation changes.
- If proof is missing, say so. Do not call the task complete just because code
  was changed.
- Do not hand-roll MCP HTTP requests with curl. Use host-exposed tools after
  restart/reload, or use the returned browser/deep-link fallback.
- Hosted default: connect
  \`https://plans.agent-native.com/_agent-native/mcp\`. Do not put shared
  secrets in skill files.
`;

const BUILT_IN_APP_SKILLS = {
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
    skillName: "visual-plans",
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "visual-plans",
      displayName: "Visual Plans",
      description:
        "Review coding-agent plans as interactive HTML with diagrams, wireframes, annotations, and proof gates.",
      hosted: {
        url: "https://plans.agent-native.com",
        mcpUrl: "https://plans.agent-native.com/_agent-native/mcp",
      },
      mcp: { serverName: "agent-native-visual-plans" },
      auth: {
        mode: "oauth",
        setup:
          "Authenticate with the Visual Plans MCP connector in the host app. No shared secrets are stored in skill files.",
      },
      surfaces: [
        {
          id: "visual-plan",
          action: "create-visual-plan",
          path: "/plans",
        },
      ],
      skills: [
        {
          path: "skills/visual-plans",
          visibility: "exported",
          exportAs: "visual-plans",
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
  plans: "visual-plans",
  plan: "visual-plans",
  "html-plan": "visual-plans",
  "plan-mode": "visual-plans",
  plannotate: "visual-plans",
  plannotator: "visual-plans",
  contracts: "visual-plans",
  contract: "visual-plans",
  proof: "visual-plans",
  "proof-check": "visual-plans",
  "assumption-review": "visual-plans",
  "agent-native-contracts": "visual-plans",
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
    "plans",
    "html-plan",
    "plannotate",
    "contracts",
    "proof-check",
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
   * Optional MCP URL override. When set, the skill's hosted MCP connector is
   * registered against this URL instead of the built-in hosted default — e.g.
   * an ngrok tunnel, a local dev origin, or a self-hosted deployment.
   */
  mcpUrl?: string;
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
    return {
      id: builtIn.manifest.id,
      displayName: builtIn.manifest.displayName,
      loaded: {
        manifest: builtIn.manifest,
        file: `<built-in:${builtIn.manifest.id}>`,
        dir: process.cwd(),
      },
      skillNames: [builtIn.skillName],
      materializeInstructions(outDir) {
        const skillDir = path.join(outDir, "skills", builtIn.skillName);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
          path.join(skillDir, "SKILL.md"),
          builtIn.skillMarkdown,
          "utf-8",
        );
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
