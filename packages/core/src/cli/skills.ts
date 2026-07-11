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
import {
  ASSETS_SKILL_MD,
  CANVAS_REFERENCE_MD,
  CONNECTION_REFERENCE_MD,
  CONTENT_SKILL_MD,
  DESIGN_EXPLORATION_SKILL_MD,
  DESIGN_VISUAL_EDIT_SKILL_MD,
  DOCUMENT_QUALITY_REFERENCE_MD,
  EXEMPLAR_REFERENCE_MD,
  HELP,
  LOCAL_FILES_REFERENCE_MD,
  VISUAL_PLANS_SKILL_MD,
  VISUAL_RECAP_SKILL_MD,
  VISUALIZE_REPO_SKILL_MD,
  WIREFRAME_REFERENCE_MD,
} from "./skills-content/index.js";
import { createCliTelemetry, type CliTelemetry } from "./telemetry.js";

export {
  CANVAS_REFERENCE_MD,
  CONNECTION_REFERENCE_MD,
  DOCUMENT_QUALITY_REFERENCE_MD,
  EXEMPLAR_REFERENCE_MD,
  LOCAL_FILES_REFERENCE_MD,
  VISUAL_PLANS_SKILL_MD,
  VISUAL_RECAP_SKILL_MD,
  VISUALIZE_REPO_SKILL_MD,
  WIREFRAME_REFERENCE_MD,
};

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
    extraSkills: {
      "visual-edit": DESIGN_VISUAL_EDIT_SKILL_MD,
    },
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
        {
          id: "visual-edit",
          action: "add-localhost-screens",
          path: "/design",
        },
      ],
      skills: [
        {
          path: "skills/design-exploration",
          visibility: "exported",
          exportAs: "design-exploration",
        },
        {
          path: "skills/visual-edit",
          visibility: "exported",
          exportAs: "visual-edit",
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
      "visualize-repo": VISUALIZE_REPO_SKILL_MD,
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
        "references/connection.md": CONNECTION_REFERENCE_MD,
        "references/local-files.md": LOCAL_FILES_REFERENCE_MD,
      },
      "visual-recap": {
        "references/wireframe.md": WIREFRAME_REFERENCE_MD,
        "references/connection.md": CONNECTION_REFERENCE_MD,
        "references/local-files.md": LOCAL_FILES_REFERENCE_MD,
      },
    },
    manifest: normalizeAppSkillManifest({
      schemaVersion: 1,
      id: "visual-plans",
      displayName: "Agent-Native Plan",
      description:
        "Create rich interactive visual plans, recaps, and repo-native visual docs with diagrams, file maps, annotated code and diffs, API/schema summaries, feedback, and HTML export.",
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
        {
          id: "visualize-repo",
          path: "/local-plans",
          description:
            "Open a local, repo-backed visual documentation workspace for APIs, components, models, flows, comments, and coding-agent handoff.",
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
        {
          path: "skills/visualize-repo",
          visibility: "exported",
          exportAs: "visualize-repo",
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
  "visual-edit": "design",
  "local-visual-edit": "design",
  "design-visual-edit": "design",
  "ux-exploration": "design",
  "agent-native-design": "design",
  "agent-native-design-exploration": "design",
  "visual-plans": "visual-plans",
  "visual-plan": "visual-plans",
  "visual-recap": "visual-plans",
  "visual-recaps": "visual-plans",
  "visualize-repo": "visual-plans",
  visualize: "visual-plans",
  "repo-visualizer": "visual-plans",
  "visual-docs": "visual-plans",
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
    "visual-edit",
    "local-visual-edit",
    "ux-exploration",
    "agent-native-design-exploration",
  ],
  "visual-plans": [
    "visual-plan",
    "visual-recap",
    "visualize-repo",
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
  installCommand: string;
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
 * (the plan bundle ships `visual-plan`, `visual-recap`, and `visualize-repo`),
 * restrict the install to just that skill. The bundle aliases (`visual-plans`,
 * `plannotate`, …) return undefined so they install every skill in the bundle.
 */
function builtInOnlySkillNames(target: string): string[] | undefined {
  const normalized = target.trim().toLowerCase();
  if (normalized === "visual-plan") return ["visual-plan"];
  if (normalized === "visual-recap" || normalized === "visual-recaps") {
    return ["visual-recap"];
  }
  if (
    normalized === "visualize-repo" ||
    normalized === "visualize" ||
    normalized === "repo-visualizer" ||
    normalized === "visual-docs"
  ) {
    return ["visualize-repo"];
  }
  if (
    normalized === "design-exploration" ||
    normalized === "agent-native-design-exploration"
  ) {
    return ["design-exploration"];
  }
  if (
    normalized === "visual-edit" ||
    normalized === "local-visual-edit" ||
    normalized === "design-visual-edit"
  ) {
    return ["visual-edit"];
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
  const parent = path.dirname(dir);
  const tempDir = path.join(
    parent,
    `.${path.basename(dir)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    for (const [rel, content] of Object.entries(bundle.files)) {
      const target = path.join(tempDir, rel);
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
      installCommand: `npx @agent-native/core@latest skills add ${bundle.skillName}`,
      updateCommand: `npx @agent-native/core@latest skills update ${bundle.skillName}`,
      ...(bundle.planMode ? { planMode: bundle.planMode } : {}),
    };
    fs.writeFileSync(
      path.join(tempDir, AGENT_NATIVE_SKILL_METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf-8",
    );
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tempDir, dir);
  } catch (error: any) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    throw new Error(
      `Cannot write Agent Native skill folder ${dir}: ${error?.message ?? error}`,
      { cause: error },
    );
  }
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
  if (skillName === "visualize-repo") {
    return `---
description: Open or create a local Agent-Native visual docs workspace for this repo.
argument-hint: [optional targets or focus]
---

Use the visualize-repo skill. Treat any arguments as source targets, repo areas,
or review focus:

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
    value: "visualize-repo",
    label: "visualize-repo",
    hint: "Local repo visual docs workspace for APIs, components, models, flows, comments, and coding-agent handoff.",
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
    value: "visual-edit",
    label: "visual-edit",
    hint: "Open a running local app in Design overview mode as URL-backed iframe screens.",
  },
  {
    value: "context-xray",
    label: "context-xray",
    hint: BUILT_IN_APP_SKILLS["context-xray"].manifest.description,
  },
];

const DEFAULT_SKILL_PROMPT_TARGETS = [
  "visual-plan",
  "visual-recap",
  "visualize-repo",
];

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
  const planSubskills = ["visual-plan", "visual-recap", "visualize-repo"];
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
        "--mode only applies to visual-plan / visual-recap / visualize-repo / content.",
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
      "--mode only applies to visual-plan / visual-recap / visualize-repo / content.",
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
  if (skillName === "visualize-repo") {
    return "When a repository needs local visual docs or a navigable Plan-backed repo viewer, use the /visualize-repo skill always.";
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
      : update
        ? `The update command only refreshes skill folders that already exist; it does not do first-time install, MCP registration, or auth. Run "npx @agent-native/core@latest skills add ${parsed.target ?? "visual-plan"}" for one-step setup.\n`
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
        "--mode only applies to visual-plan / visual-recap / visualize-repo / content.",
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
