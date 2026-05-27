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
import { resolveClients } from "./connect.js";
import type { ClientId } from "./mcp-config-writers.js";

const HELP = `agent-native skills

Usage:
  agent-native skills list
  agent-native skills add assets [--client codex|claude-code|claude-code-cli|cowork|all] [--scope user|project] [--yes] [--dry-run] [--json]
  agent-native skills add <manifest-or-app-dir> [--client ...] [--yes]

Examples:
  agent-native skills add assets
  agent-native skills add assets --client claude-code
  agent-native skills add ./dist/assets-skill --client codex

The add command installs skill instructions with the open skills CLI, then
registers the app-backed MCP connector. Use app-skill pack for marketplace
bundles and custom adapter output.`;

const ASSETS_SKILL_MD = `---
name: assets
description: >-
  Use Assets for brand-safe image or video generation, human picker UI,
  search/list/export actions, and cross-app asset selection.
metadata:
  visibility: exported
---

# Assets

Use the Assets app when a workflow needs reusable brand media, a human picker,
or generated image/video assets that another app can reference by ID and URL.

## Choose The Path

- Use \`open-asset-picker\` when a person should browse, search, generate, and
  select an asset in UI. Pass \`mediaType: "image"\` by default, or
  \`mediaType: "video"\` for video libraries.
- Use unattended actions when the agent already knows what to do:
  \`search-assets\`, \`list-assets\`, \`generate-image\`,
  \`generate-image-batch\`, \`generate-video\`,
  \`refresh-generation-run\`, and \`export-asset\`.
- Use browser/deep-link fallback when the host cannot render MCP Apps inline.
  Surface the returned picker link instead of inventing a separate UI.

## Image And Video Workflows

1. Pick or match the library with \`list-libraries\` or \`match-library\`.
2. For images, call \`generate-image\` or \`generate-image-batch\`.
3. For videos, call \`generate-video\` and poll \`refresh-generation-run\`
   until the run completes.
4. Preserve returned \`assetId\`, \`runId\`, \`previewUrl\`, \`downloadUrl\`,
   media type, and dimensions so the caller can attach or embed the result.

## Cross-App Use

- Hosted default: connect \`https://assets.agent-native.com/_agent-native/mcp\`.
  Do not put shared secrets in skill files.
- Local customization: use \`agent-native app-skill launch --local\` from an
  Assets app-skill manifest, or pass \`--into <path>\` for editable source.
- Do not call image/video providers directly from another app. Assets owns
  generation, picker UI, search/list/export, and asset context.
`;

const BUILT_IN_APP_SKILLS = {
  assets: {
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
} satisfies Record<
  string,
  { manifest: AppSkillManifest; skillMarkdown: string }
>;

type SkillsCommand = "list" | "add" | "help";

export interface ParsedSkillsArgs {
  command: SkillsCommand;
  target?: string;
  client: string;
  scope: string;
  yes: boolean;
  dryRun: boolean;
  printJson: boolean;
  instructions: boolean;
  mcp: boolean;
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
}

interface SkillInstallTarget {
  id: string;
  displayName: string;
  loaded: LoadedAppSkillManifest;
  skillNames: string[];
  materializeInstructions(outDir: string): string;
  cleanup?: () => void;
}

interface RunSkillsOptions {
  baseDir?: string;
  log?: (message: string) => void;
  runCommand?: (cmd: string, args: string[]) => Promise<number>;
}

function isKnownSkill(value: string | undefined): value is "assets" {
  return value === "assets";
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
    if ((value = eat("--client")) !== undefined) out.client = value;
    else if ((value = eat("--scope")) !== undefined) out.scope = value;
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
  if (isKnownSkill(target)) {
    const builtIn = BUILT_IN_APP_SKILLS[target];
    return {
      id: builtIn.manifest.id,
      displayName: builtIn.manifest.displayName,
      loaded: {
        manifest: builtIn.manifest,
        file: `<built-in:${builtIn.manifest.id}>`,
        dir: process.cwd(),
      },
      skillNames: ["assets"],
      materializeInstructions(outDir) {
        const skillDir = path.join(outDir, "skills", "assets");
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

function commandString(cmd: string, args: string[]): string {
  return [cmd, ...args].join(" ");
}

async function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${cmd} was interrupted by ${signal}.`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

export async function addAgentNativeSkill(
  parsed: ParsedSkillsArgs,
  options: RunSkillsOptions = {},
): Promise<SkillsAddResult> {
  const target = parsed.target ?? "assets";
  if (!isKnownSkill(target) && !fs.existsSync(path.resolve(target))) {
    throw new Error(
      `Unknown skill or manifest path: ${target}. Run "agent-native skills list".`,
    );
  }
  const installTarget = loadSkillTarget(target);
  const clients = resolveClients(parsed.client);
  const skillsAgents = skillsAgentsForClients(clients);
  const commands: string[] = [];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-add-"));
  let instructionSource: string | undefined;

  try {
    if (parsed.instructions) {
      if (skillsAgents.length === 0) {
        throw new Error(
          "Skill instructions can only be installed for Codex or Claude Code clients. Use --mcp-only for MCP-only clients.",
        );
      }
      instructionSource = installTarget.materializeInstructions(tmpRoot);
      const args = [
        "--yes",
        "skills@latest",
        "add",
        instructionSource,
        "--copy",
        ...installTarget.skillNames.flatMap((skill) => ["--skill", skill]),
        ...skillsAgents.flatMap((agent) => ["-a", agent]),
        ...(parsed.yes || isKnownSkill(target) ? ["-y"] : []),
      ];
      commands.push(commandString("npx", args));
      if (!parsed.dryRun) {
        const code = await (options.runCommand ?? runCommand)("npx", args);
        if (code !== 0) throw new Error(`npx skills add exited with ${code}.`);
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
          yes: parsed.yes || isKnownSkill(target),
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
    name: entry.manifest.displayName,
    description: entry.manifest.description,
    mcpUrl: entry.manifest.hosted.mcpUrl,
  }));
}

export async function runSkills(
  argv: string[],
  options: RunSkillsOptions = {},
): Promise<void> {
  const parsed = parseSkillsArgs(argv);
  const log = (message: string) =>
    (parsed.printJson ? process.stderr : process.stdout).write(`${message}\n`);

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
      process.stdout.write(
        `${skill.id.padEnd(12)} ${skill.description} (${skill.mcpUrl})\n`,
      );
    }
    return;
  }

  const result = await addAgentNativeSkill(parsed, {
    ...options,
    log,
  });

  if (parsed.printJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (parsed.dryRun) {
    process.stdout.write(`${result.commands.join("\n")}\n`);
    return;
  }

  process.stdout.write(
    `Installed ${result.displayName} skill for ${result.skillsAgents.join(
      ", ",
    )} and registered ${result.mcpUrl} for ${result.mcpClients.join(", ")}.\n`,
  );
}
