import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { resolveAppForSkill } from "./built-in-apps.js";
import { registerMcpServer } from "./connect.js";
import type { ClientId } from "./mcp-config-writers.js";
import { createCliTelemetry, type CliTelemetry } from "./telemetry.js";

export type SkillClient = "codex" | "claude-code";
export type SkillScope = "project" | "user";

export interface SkillEntry {
  name: string;
  dir: string;
  description?: string;
}

export interface InstallSkillsOptions {
  source?: string;
  skillNames?: string[];
  clients?: SkillClient[];
  scope?: SkillScope;
  baseDir?: string;
  yes?: boolean;
  dryRun?: boolean;
  updateInstructions?: boolean;
  instructionFiles?: string[];
  withGithubAction?: boolean;
  force?: boolean;
  log?: (message: string) => void;
  isInteractive?: () => boolean;
  telemetry?: CliTelemetry;
  /**
   * Register the hosted MCP server for app-backed skills (e.g. visual-plan /
   * visual-recap → the Agent-Native Plan MCP). Defaults to `true`; pass
   * `false` (CLI `--no-mcp`) to install the skill files only.
   */
  mcp?: boolean;
}

export interface InstalledMcpServer {
  serverName: string;
  mcpUrl: string;
  clients: SkillClient[];
  files: string[];
  authenticated: boolean;
  guidance: string[];
}

export interface InstallSkillsResult {
  source: string;
  skills: string[];
  clients: SkillClient[];
  scope: SkillScope;
  written: string[];
  instructionFiles: string[];
  githubActionPath?: string;
  mcpServers: InstalledMcpServer[];
  dryRun: boolean;
}

interface ParsedArgs {
  command: "add" | "list" | "help";
  source?: string;
  copySource: boolean;
  skillNames: string[];
  clients: SkillClient[];
  scope: SkillScope;
  scopeExplicit: boolean;
  yes: boolean;
  dryRun: boolean;
  printJson: boolean;
  updateInstructions?: boolean;
  instructionFiles: string[];
  withGithubAction: boolean;
  force: boolean;
  baseDir?: string;
  mcp: boolean;
}

const HELP = `@agent-native/skills

Usage:
  npx @agent-native/skills add [options]
  npx @agent-native/skills list

Options:
  --skill <name>              Install only this skill (repeatable)
  --client, -a <client>       codex, claude-code, or all (repeatable or comma-separated)
  --scope <user|project>      Install globally or into the current project (default: user)
  -g, --global                Alias for --scope user
  --project                   Alias for --scope project
  --update-instructions       Add managed AGENTS.md / CLAUDE.md instructions when useful
  --no-update-instructions    Skip managed instruction file updates
  --instructions-file <path>  File to receive managed instructions (repeatable)
  --with-github-action        Add .github/workflows/pr-visual-recap.yml when visual-recap is installed
  --force                     Overwrite a different existing PR Visual Recap workflow
  --no-mcp                    Install skill files only; skip registering the app's MCP server
  -y, --yes                   Use defaults in non-interactive mode
  --dry-run                   Print intended writes without changing files
  --json                      Print the result as JSON

App-backed skills (visual-plan, visual-recap, assets, design-exploration)
register their hosted MCP server in your agent config by default so the agent
can actually use them. Use --no-mcp to skip that and copy the files only.

Examples:
  npx @agent-native/skills add
  npx @agent-native/skills add --skill quick-recap
  npx @agent-native/skills add --skill visual-recap --with-github-action
`;

const CLIENTS: SkillClient[] = ["codex", "claude-code"];
const DEFAULT_SKILLS_SOURCE = "BuilderIO/skills";
const MANAGED_INSTRUCTIONS_START = "<!-- BEGIN @agent-native/skills -->";
const MANAGED_INSTRUCTIONS_END = "<!-- END @agent-native/skills -->";

export function parseSkillsCliArgs(argv: string[]): ParsedArgs {
  const first = argv[0];
  if (!first || first === "help" || first === "--help" || first === "-h") {
    return defaultArgs("help");
  }

  const command = first === "list" ? "list" : "add";
  const args = first === "add" || first === "list" ? argv.slice(1) : argv;
  const out = defaultArgs(command);

  for (let i = 0; i < args.length; i += 1) {
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
    if ((value = eat("--skill")) !== undefined) out.skillNames.push(value);
    else if ((value = eat("-s")) !== undefined) out.skillNames.push(value);
    else if ((value = eat("--client")) !== undefined)
      out.clients.push(...normalizeClients(value));
    else if ((value = eat("--agent")) !== undefined)
      out.clients.push(...normalizeClients(value));
    else if ((value = eat("-a")) !== undefined)
      out.clients.push(...normalizeClients(value));
    else if ((value = eat("--scope")) !== undefined) {
      out.scope = parseScope(value);
      out.scopeExplicit = true;
    } else if ((value = eat("--instructions-file")) !== undefined)
      out.instructionFiles.push(value);
    else if ((value = eat("--cwd")) !== undefined) out.baseDir = value;
    else if (arg === "-g" || arg === "--global") {
      out.scope = "user";
      out.scopeExplicit = true;
    } else if (arg === "--project") {
      out.scope = "project";
      out.scopeExplicit = true;
    } else if (arg === "--copy") {
      // Compatibility with the open `skills` CLI. This installer always copies.
      out.copySource = true;
    } else if (arg === "-y" || arg === "--yes") out.yes = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--json") out.printJson = true;
    else if (arg === "--update-instructions") out.updateInstructions = true;
    else if (arg === "--no-update-instructions") out.updateInstructions = false;
    else if (arg === "--with-github-action" || arg === "--with-github-actions")
      out.withGithubAction = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--no-mcp") out.mcp = false;
    else if (arg === "--mcp") out.mcp = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (!out.source) out.source = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  if (out.source && out.source !== DEFAULT_SKILLS_SOURCE && !out.copySource) {
    throw new Error(
      `Unexpected argument: ${out.source}. @agent-native/skills installs the BuilderIO skills collection; use --skill <name> to choose a skill.`,
    );
  }
  if (out.source === DEFAULT_SKILLS_SOURCE && !out.copySource) {
    out.source = undefined;
  }

  out.skillNames = unique(out.skillNames.map(normalizeSkillName));
  out.clients = unique(out.clients);
  out.instructionFiles = unique(out.instructionFiles);
  return out;
}

/**
 * Translate this package's parsed args into the argv shape `@agent-native/core`
 * skills expects. Core takes a single positional target + compatible flags; we
 * forward one explicit skill as that target and let core's interactive picker
 * handle 0-or-many selections.
 */
function toCoreSkillsArgv(parsed: ParsedArgs): string[] {
  const out: string[] = [parsed.command];
  if (parsed.command !== "add") return out;
  if (parsed.skillNames.length === 1) out.push(parsed.skillNames[0]);
  else if (parsed.copySource && parsed.source) out.push(parsed.source);
  if (parsed.clients.length) out.push("--client", parsed.clients.join(","));
  if (parsed.scopeExplicit) out.push("--scope", parsed.scope);
  if (parsed.yes) out.push("--yes");
  if (parsed.dryRun) out.push("--dry-run");
  if (parsed.printJson) out.push("--json");
  if (parsed.withGithubAction) out.push("--with-github-action");
  if (parsed.force) out.push("--force");
  if (parsed.mcp === false) out.push("--no-mcp");
  if (parsed.updateInstructions === true) out.push("--update-instructions");
  if (parsed.updateInstructions === false) out.push("--no-update-instructions");
  return out;
}

export async function runSkillsCli(
  argv: string[],
  options: Pick<InstallSkillsOptions, "log" | "isInteractive" | "baseDir"> = {},
): Promise<void> {
  const parsed = parseSkillsCliArgs(argv);

  // PIVOT: `@agent-native/skills` delegates its install/list flow to
  // `@agent-native/core`'s clack-based installer so both CLIs share ONE codebase
  // and UX. App-backed skills (visual-plan/visual-recap/assets/design-exploration/
  // context-xray) and the interactive picker go through core. Plain BuilderIO
  // skills (efficient-fable, quick-recap, …) aren't known to core, so an explicit
  // plain `--skill` falls through to this package's own headless installer.
  // AGENT_NATIVE_SKILLS_DIRECT=1 (set when core delegates a plain repo back to us)
  // always forces the direct path and breaks the skills → core → skills loop.
  if (process.env.AGENT_NATIVE_SKILLS_DIRECT !== "1") {
    const appOnly =
      parsed.skillNames.length === 0 ||
      parsed.skillNames.every((name) => resolveAppForSkill(name) !== undefined);
    if (parsed.command === "list" || (parsed.command === "add" && appOnly)) {
      const { runSkills } = await import("@agent-native/core/cli/skills");
      await runSkills(toCoreSkillsArgv(parsed), {
        isInteractive: options.isInteractive,
        baseDir: parsed.baseDir ?? options.baseDir,
      });
      return;
    }
  }

  const startedAt = Date.now();
  const telemetry = createCliTelemetry({
    cli: "skills-installer",
    cliVersion: readCliVersion(),
    command: parsed.command,
    interactive: cliInteractive(parsed, options),
  });

  try {
    if (parsed.command === "help") {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    telemetry.track("skills_cli started");
    const skillSource = parsed.source ?? DEFAULT_SKILLS_SOURCE;

    if (parsed.command === "list") {
      const source = await materializeSource(skillSource);
      try {
        const skills = discoverSkills(source.root);
        telemetry.track("skills_cli skills listed", {
          availableCount: skills.length,
          available: skills.map((skill) => skill.name).join(","),
        });
        if (parsed.printJson) {
          process.stdout.write(`${JSON.stringify(skills, null, 2)}\n`);
          return;
        }
        for (const skill of skills) {
          process.stdout.write(
            `${skill.name}${skill.description ? ` - ${skill.description}` : ""}\n`,
          );
        }
        return;
      } finally {
        source.cleanup?.();
      }
    }

    const result = await installSkills({
      source: skillSource,
      skillNames: parsed.skillNames,
      clients: parsed.clients,
      // Leave scope undefined unless the user passed --scope/-g/--project so the
      // installer can prompt for it interactively.
      scope: parsed.scopeExplicit ? parsed.scope : undefined,
      baseDir: parsed.baseDir ?? options.baseDir,
      yes: parsed.yes,
      dryRun: parsed.dryRun,
      updateInstructions: parsed.updateInstructions,
      instructionFiles: parsed.instructionFiles,
      withGithubAction: parsed.withGithubAction,
      force: parsed.force,
      log: parsed.printJson ? undefined : options.log,
      isInteractive: options.isInteractive,
      telemetry,
      mcp: parsed.mcp,
    });

    telemetry.track("skills_cli completed", {
      skills: result.skills.join(","),
      clients: result.clients.join(","),
      scope: result.scope,
      dryRun: result.dryRun,
      durationMs: Date.now() - startedAt,
    });

    if (parsed.printJson) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    const verb = parsed.dryRun ? "Would install" : "Installed";
    process.stdout.write(
      [
        `${verb} ${result.skills.join(", ")} for ${result.clients.join(", ")} (${result.scope}).`,
        result.written.length
          ? `Skill files: ${result.written.join(", ")}`
          : "",
        result.instructionFiles.length
          ? `Managed instructions: ${result.instructionFiles.join(", ")}`
          : "",
        result.githubActionPath
          ? `PR Visual Recap workflow: ${result.githubActionPath}`
          : "",
        ...result.mcpServers.flatMap((server) => [
          `MCP server "${server.serverName}" ${
            parsed.dryRun ? "would be registered" : "registered"
          } for ${server.clients.join(", ")}${
            server.files.length ? `:\n  ${server.files.join("\n  ")}` : ""
          }`,
          ...server.guidance.map((line) => `  ${line}`),
        ]),
        parsed.dryRun
          ? ""
          : "Restart or reload selected agent clients if needed.",
      ]
        .filter(Boolean)
        .join("\n") + "\n",
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

function readCliVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/index.js → ../package.json
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(here, "../package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function cliInteractive(
  parsed: ParsedArgs,
  options: Pick<InstallSkillsOptions, "isInteractive">,
): boolean {
  if (parsed.yes) return false;
  if (options.isInteractive) return options.isInteractive();
  if (process.env.CI === "true") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export async function installSkills(
  options: InstallSkillsOptions,
): Promise<InstallSkillsResult> {
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const log = options.log ?? (() => {});
  const sourceInput = options.source ?? DEFAULT_SKILLS_SOURCE;
  const source = await materializeSource(sourceInput);
  try {
    const entries = discoverSkills(source.root);
    if (entries.length === 0) {
      throw new Error(
        `No skills found in ${sourceInput}. Expected skills/*/SKILL.md.`,
      );
    }

    // Fire the "skills prompted" step only when an interactive chooser will
    // actually be shown (mirrors resolveSelectedSkills's prompt condition), so
    // the funnel distinguishes "saw the picker" from "passed --skill".
    const preselected = (options.skillNames ?? []).length > 0;
    if (isInteractive(options) && !options.yes && !preselected) {
      options.telemetry?.track("skills_cli skills prompted", {
        availableCount: entries.length,
        available: entries.map((entry) => entry.name).join(","),
      });
    }

    const selected = await resolveSelectedSkills(entries, options);
    options.telemetry?.track("skills_cli skills selected", {
      selected: selected.map((skill) => skill.name).join(","),
      selectedCount: selected.length,
      selectedAll: selected.length === entries.length,
      preselected,
    });

    const clients = await resolveSelectedClients(options);
    options.telemetry?.track("skills_cli clients selected", {
      clients: clients.join(","),
      clientCount: clients.length,
    });

    const scope = await resolveSelectedScope(options);
    options.telemetry?.track("skills_cli scope selected", { scope });

    const written: string[] = [];

    for (const client of clients) {
      const root = installRootForClient(client, scope, baseDir);
      for (const skill of selected) {
        const destination = path.join(root, skill.name);
        written.push(destination);
        if (!options.dryRun) {
          fs.rmSync(destination, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.cpSync(skill.dir, destination, { recursive: true });
        }
      }
    }

    options.telemetry?.track("skills_cli install completed", {
      skills: selected.map((skill) => skill.name).join(","),
      clients: clients.join(","),
      scope,
      writtenCount: written.length,
      dryRun: Boolean(options.dryRun),
    });

    const instructionFiles = await maybeUpdateInstructions(
      selected.map((skill) => skill.name),
      baseDir,
      options,
    );
    if (instructionFiles.length) {
      options.telemetry?.track("skills_cli instructions updated", {
        fileCount: instructionFiles.length,
      });
    }

    const githubActionPath =
      selected.some((skill) => skill.name === "visual-recap") &&
      (options.withGithubAction ||
        (await shouldPromptGithubAction(options, baseDir)))
        ? writePrVisualRecapWorkflow(baseDir, options)
        : undefined;
    if (githubActionPath) {
      options.telemetry?.track("skills_cli github action added");
    }

    // Register the hosted MCP server for app-backed skills (visual-plan /
    // visual-recap → Agent-Native Plan, assets, design-exploration) so the
    // agent can actually call them — not just read the SKILL.md. On by
    // default; `--no-mcp` installs the skill files only. One registration per
    // app, so visual-plan + visual-recap share a single "plan" server.
    const mcpServers: InstalledMcpServer[] = [];
    if (options.mcp !== false) {
      const mcpClients: ClientId[] = clients.map((client) =>
        client === "claude-code" ? "claude-code" : "codex",
      );
      const seenApps = new Set<string>();
      for (const skill of selected) {
        const app = resolveAppForSkill(skill.name);
        if (!app || seenApps.has(app.appId)) continue;
        seenApps.add(app.appId);
        if (options.dryRun) {
          mcpServers.push({
            serverName: app.serverName,
            mcpUrl: app.mcpUrl,
            clients,
            files: [],
            authenticated: false,
            guidance: [],
          });
          continue;
        }
        const registration = await registerMcpServer({
          descriptor: {
            serverName: app.serverName,
            mcpUrl: app.mcpUrl,
            aliases: app.aliases,
            authMode: app.authMode,
            hostedUrl: app.hostedUrl,
          },
          clients: mcpClients,
          scope,
          baseDir,
          interactive: isInteractive(options),
          log,
        });
        mcpServers.push({
          serverName: app.serverName,
          mcpUrl: app.mcpUrl,
          clients,
          files: [...new Set(registration.written.map((entry) => entry.file))],
          authenticated: registration.authenticated,
          guidance: registration.guidance,
        });
        options.telemetry?.track("skills_cli mcp registered", {
          serverName: app.serverName,
          clients: clients.join(","),
          authenticated: registration.authenticated,
        });
      }
    }

    log(
      `Resolved ${selected.length} skill${selected.length === 1 ? "" : "s"} from ${source.root}.`,
    );
    return {
      source: source.root,
      skills: selected.map((skill) => skill.name),
      clients,
      scope,
      written,
      instructionFiles,
      githubActionPath,
      mcpServers,
      dryRun: Boolean(options.dryRun),
    };
  } finally {
    source.cleanup?.();
  }
}

function defaultArgs(command: ParsedArgs["command"]): ParsedArgs {
  return {
    command,
    copySource: false,
    skillNames: [],
    clients: [],
    scope: "user",
    scopeExplicit: false,
    yes: false,
    dryRun: false,
    printJson: false,
    instructionFiles: [],
    withGithubAction: false,
    force: false,
    mcp: true,
  };
}

function parseScope(value: string): SkillScope {
  if (value === "user" || value === "project") return value;
  throw new Error("--scope must be user or project.");
}

function normalizeClients(value: string): SkillClient[] {
  return value.split(",").flatMap((raw) => {
    const client = raw.trim().toLowerCase();
    if (!client) return [];
    if (client === "all") return CLIENTS;
    if (client === "codex") return ["codex" as const];
    if (
      client === "claude" ||
      client === "claude-code" ||
      client === "claude-code-cli"
    ) {
      return ["claude-code" as const];
    }
    throw new Error(
      `Unsupported client "${raw}". Use codex, claude-code, or all.`,
    );
  });
}

function normalizeSkillName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(`Invalid skill name "${value}".`);
  }
  return normalized;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function resolveSelectedSkills(
  entries: SkillEntry[],
  options: InstallSkillsOptions,
): Promise<SkillEntry[]> {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const requested = unique((options.skillNames ?? []).map(normalizeSkillName));
  if (requested.length > 0) {
    const missing = requested.filter((name) => !byName.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Unknown skill${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Available: ${entries
          .map((entry) => entry.name)
          .join(", ")}.`,
      );
    }
    return requested.map((name) => byName.get(name)!);
  }

  if (!isInteractive(options) || options.yes) return entries;

  const answer = await promptLine(
    [
      "Which skills do you want to install?",
      ...entries.map(
        (entry, index) =>
          `  ${index + 1}. ${entry.name}${entry.description ? ` - ${entry.description}` : ""}`,
      ),
      "Enter numbers or names separated by commas, or press Enter for all: ",
    ].join("\n"),
  );
  const trimmed = answer.trim();
  if (!trimmed) return entries;
  const selectedNames = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const asNumber = Number(part);
      if (
        Number.isInteger(asNumber) &&
        asNumber >= 1 &&
        asNumber <= entries.length
      ) {
        return entries[asNumber - 1].name;
      }
      return normalizeSkillName(part);
    });
  return resolveSelectedSkills(entries, {
    ...options,
    skillNames: selectedNames,
  });
}

async function resolveSelectedScope(
  options: InstallSkillsOptions,
): Promise<SkillScope> {
  if (options.scope) return options.scope;
  if (!isInteractive(options) || options.yes) return "user";

  const answer = await promptLine(
    [
      "Where do you want to install these skills?",
      "  1. project - this repo only (.agents / .claude in the current directory)",
      "  2. user    - your home directory, available across all projects",
      "Enter project or user [project]: ",
    ].join("\n"),
  );
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "2" || trimmed === "user" || trimmed === "u") return "user";
  return "project";
}

async function resolveSelectedClients(
  options: InstallSkillsOptions,
): Promise<SkillClient[]> {
  const requested = unique(options.clients ?? []);
  if (requested.length > 0) return requested;
  if (!isInteractive(options) || options.yes) return ["codex"];

  const answer = await promptLine(
    "Install for which clients? Enter codex, claude-code, or all [codex]: ",
  );
  const trimmed = answer.trim();
  return trimmed ? unique(normalizeClients(trimmed)) : ["codex"];
}

function isInteractive(
  options: Pick<InstallSkillsOptions, "isInteractive">,
): boolean {
  if (options.isInteractive) return options.isInteractive();
  if (process.env.CI === "true") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptLine(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function installRootForClient(
  client: SkillClient,
  scope: SkillScope,
  baseDir: string,
): string {
  const home = process.env.HOME || os.homedir();
  if (scope === "project") {
    return client === "codex"
      ? path.join(baseDir, ".agents", "skills")
      : path.join(baseDir, ".claude", "skills");
  }
  if (client === "codex") {
    return process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, "skills")
      : path.join(home, ".codex", "skills");
  }
  return path.join(home, ".claude", "skills");
}

function discoverSkills(root: string): SkillEntry[] {
  const skillsRoot = resolveSkillsRoot(root);
  const directSkill = path.join(skillsRoot, "SKILL.md");
  if (fs.existsSync(directSkill)) {
    const entry = skillEntry(skillsRoot);
    return entry ? [entry] : [];
  }
  const entries = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => skillEntry(path.join(skillsRoot, entry.name)))
    .filter((entry): entry is SkillEntry => Boolean(entry));
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function resolveSkillsRoot(root: string): string {
  for (const manifestPath of [
    path.join(root, ".codex-plugin", "plugin.json"),
    path.join(root, ".claude-plugin", "plugin.json"),
  ]) {
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
        skills?: unknown;
      };
      if (typeof manifest.skills === "string") {
        const resolved = path.resolve(root, manifest.skills);
        if (fs.existsSync(resolved)) return resolved;
      }
    } catch {}
  }
  const conventional = path.join(root, "skills");
  if (fs.existsSync(conventional)) return conventional;
  return root;
}

function skillEntry(dir: string): SkillEntry | null {
  const skillFile = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillFile)) return null;
  const body = fs.readFileSync(skillFile, "utf-8");
  const frontmatter = body.match(/^---\n([\s\S]*?)\n---/);
  const name =
    frontmatter?.[1]
      ?.match(/^name:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]
      ?.trim() ?? path.basename(dir);
  const description = frontmatter?.[1]
    ?.match(/^description:\s*(?:>-\s*)?(.+)$/m)?.[1]
    ?.trim();
  return { name: normalizeSkillName(name), dir, description };
}

async function materializeSource(input: string): Promise<{
  root: string;
  cleanup?: () => void;
}> {
  const local = path.resolve(input);
  if (fs.existsSync(local)) return { root: local };

  const parsed = parseGitHubSource(input);
  if (!parsed) {
    throw new Error(
      `Skill source not found: ${input}. Use a local path, GitHub owner/repo, or GitHub URL.`,
    );
  }

  const tmpRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-skills-"),
  );
  const archive = path.join(tmpRoot, "source.tgz");
  const ref = parsed.ref ?? "main";
  const url = `https://codeload.github.com/${parsed.owner}/${parsed.repo}/tar.gz/${encodeURIComponent(ref)}`;
  const response = await fetch(url, {
    headers: { "user-agent": "@agent-native/skills" },
  });
  if (!response.ok) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    throw new Error(
      `Could not download ${parsed.owner}/${parsed.repo}@${ref}: HTTP ${response.status}.`,
    );
  }
  fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

  const extractDir = path.join(tmpRoot, "extract");
  fs.mkdirSync(extractDir, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", extractDir], {
    stdio: "pipe",
    encoding: "utf-8",
  });
  if (extracted.status !== 0) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    throw new Error(
      `Could not extract ${input}: ${extracted.stderr || extracted.stdout}`,
    );
  }
  const [first] = fs
    .readdirSync(extractDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  if (!first) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    throw new Error(
      `Downloaded archive for ${input} did not contain a repo directory.`,
    );
  }
  return {
    root: path.join(extractDir, first.name),
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

function parseGitHubSource(
  input: string,
): { owner: string; repo: string; ref?: string } | null {
  const shorthand = input.match(
    /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#(.+))?$/,
  );
  if (shorthand) {
    return {
      owner: shorthand[1],
      repo: shorthand[2].replace(/\.git$/, ""),
      ref: shorthand[3],
    };
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const treeIndex = parts.indexOf("tree");
  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/, ""),
    ref:
      treeIndex >= 0 && parts[treeIndex + 1]
        ? parts.slice(treeIndex + 1).join("/")
        : url.hash.slice(1) || undefined,
  };
}

function instructionContentForSkill(skillName: string): string | null {
  if (skillName === "quick-recap") {
    return `## Quick Recap Status Block

Every response that completes a unit of work must end with one final status line:

\`\`\`md
🟢 Actual concise status sentence
\`\`\`

Use 🟢 when the requested work is finished. Use 🟡 when non-routine follow-up work or a manual step remains, and name that pending item. Use 🔴 only when blocked on user input. Keep the status line under 100 characters. Put the status line at the very end of the response. Do not add \`---\`, spacer lines, or any content after it.

Examples:

\`\`\`md
🟢 Updated quick recap docs with output examples
\`\`\`

\`\`\`md
🟡 Code updated, set PROVIDER_WEBHOOK_SECRET before testing webhooks
\`\`\`

\`\`\`md
🔴 Need the production API key to continue
\`\`\``;
  }
  if (skillName === "efficient-fable") {
    return `## Efficient Fable

When operating as Claude Fable or another explicitly Fable-class expensive model, preserve Fable for the judgment layer: decomposition, architecture and product tradeoffs, synthesis, risk calls, and final review. Delegate token-heavy research, coding, testing, file inventory, repetitive edits, and independent implementation slices to cheaper subagents when available. Write delegated prompts as self-contained handoff packets with objective, scope, out-of-scope areas, expected evidence, verification commands, and stop conditions. For testing, Fable should suggest the validation direction and important scripts or browser checks, then lighter agents can run them, reduce logs, collect screenshots, and report exact failures and likely causes. Treat delegated reports as leads: Fable should verify important cited files, failures, and high-risk diffs before relying on them. Do not make unsupported quality or speed guarantees; frame savings as workload-dependent.`;
  }
  if (skillName === "efficient-frontier") {
    return `## Efficient Frontier

When running any high-cost frontier model on a codebase-heavy task, act as the orchestrator and reviewer. Split independent research, search, summarization, coding, and testing work into cheaper/faster subagents when the host supports them, then spend frontier-model tokens on the plan, tradeoffs, integration decisions, validation strategy, and final quality pass. Delegated prompts should be self-contained: objective, repo path, scope, out-of-scope areas, expected evidence, verification commands, and stop conditions. For testing-heavy work, the frontier model should choose the scripts or browser flows that matter while lighter agents run checks, reduce output, and return the concrete signal. Treat delegated findings as leads and verify important claims before presenting them as facts.`;
  }
  if (skillName === "stay-within-limits") {
    return `## Stay Within Limits

Before starting long-running or parallel agent work, and between waves, check current 5-hour and weekly usage limits with the host's usage tool. For Claude Code, use npx -y ccusage@latest blocks --active --json when no better first-party signal is available. Keep waves to at most 3 parallel subagents by default. If either active 5-hour or weekly window is at or above 95%, do not launch more work; pause until the window clears. When a wake/resume tool is available, schedule a self-contained wake prompt for min(3600, secondsUntilWindowClears), re-check the actual block/window on wake, reschedule if still over budget, and only continue when safely below the threshold. The wake prompt should restate the remaining plan, usage check, wave throttle, verification steps, and any delegation scope or stop conditions needed for the next wave. Check between waves, not mid-wave.`;
  }
  return null;
}

async function maybeUpdateInstructions(
  skillNames: string[],
  baseDir: string,
  options: InstallSkillsOptions,
): Promise<string[]> {
  const blocks = skillNames
    .map((name) => instructionContentForSkill(name))
    .filter((block): block is string => Boolean(block));
  if (blocks.length === 0) return [];

  let shouldUpdate = options.updateInstructions;
  if (shouldUpdate === undefined) {
    if (options.yes) shouldUpdate = true;
    else if (isInteractive(options)) {
      const answer = await promptLine(
        "Add managed AGENTS.md / CLAUDE.md instructions for always-on behavior? [Y/n] ",
      );
      shouldUpdate = !/^n/i.test(answer.trim());
    } else {
      shouldUpdate = false;
    }
  }
  if (!shouldUpdate) return [];

  const files = resolveInstructionFiles(baseDir, options.instructionFiles);
  const content = `${MANAGED_INSTRUCTIONS_START}
${blocks.join("\n\n")}
${MANAGED_INSTRUCTIONS_END}`;
  for (const file of files) {
    if (options.dryRun) continue;
    upsertManagedBlock(file, content);
  }
  return files;
}

function resolveInstructionFiles(
  baseDir: string,
  explicit: string[] | undefined,
): string[] {
  if (explicit && explicit.length > 0) {
    return explicit.map((file) => path.resolve(baseDir, file));
  }
  const candidates = ["AGENTS.md", "CLAUDE.md"].map((file) =>
    path.join(baseDir, file),
  );
  const existing = candidates.filter((file) => fs.existsSync(file));
  return existing.length > 0 ? existing : [path.join(baseDir, "AGENTS.md")];
}

function upsertManagedBlock(file: string, block: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  const pattern = new RegExp(
    `${escapeRegExp(MANAGED_INSTRUCTIONS_START)}[\\s\\S]*?${escapeRegExp(MANAGED_INSTRUCTIONS_END)}`,
  );
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trimEnd()}${existing.trim() ? "\n\n" : ""}${block}\n`;
  fs.writeFileSync(file, next, "utf-8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function shouldPromptGithubAction(
  options: InstallSkillsOptions,
  baseDir: string,
): Promise<boolean> {
  if (options.withGithubAction) return true;
  if (options.yes || !isInteractive(options)) return false;
  if (
    fs.existsSync(
      path.join(baseDir, ".github", "workflows", "pr-visual-recap.yml"),
    )
  ) {
    return false;
  }
  const answer = await promptLine(
    "Add the optional PR Visual Recap GitHub Action? [y/N] ",
  );
  return /^y/i.test(answer.trim());
}

const PR_VISUAL_RECAP_REUSABLE_WORKFLOW = `name: PR Visual Recap

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read

concurrency:
  group: pr-visual-recap-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  visual-recap:
    permissions:
      checks: write
      contents: read
      issues: write
      pull-requests: read
    uses: BuilderIO/agent-native/.github/workflows/pr-visual-recap-reusable.yml@main
    with:
      skill-source: repo
    secrets:
      PLAN_RECAP_TOKEN: \${{ secrets.PLAN_RECAP_TOKEN }}
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
      PLAN_RECAP_APP_URL: \${{ secrets.PLAN_RECAP_APP_URL }}
`;

function writePrVisualRecapWorkflow(
  baseDir: string,
  options: InstallSkillsOptions,
): string {
  const file = path.join(
    baseDir,
    ".github",
    "workflows",
    "pr-visual-recap.yml",
  );
  if (options.dryRun) return file;
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, "utf-8");
    if (current === PR_VISUAL_RECAP_REUSABLE_WORKFLOW) return file;
    if (!options.force) {
      throw new Error(
        `${file} already exists and differs. Re-run with --force to overwrite it.`,
      );
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PR_VISUAL_RECAP_REUSABLE_WORKFLOW, "utf-8");
  return file;
}

export function createInstallId(): string {
  return randomUUID();
}
