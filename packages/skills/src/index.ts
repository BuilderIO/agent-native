import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppForSkill, type BuiltInAppMcp } from "./built-in-apps.js";
import { registerMcpServer } from "./connect.js";
import type { ClientId } from "./mcp-config-writers.js";
import { createCliTelemetry, type CliTelemetry } from "./telemetry.js";

export type SkillClient = "codex" | "claude-code";
export type SkillScope = "project" | "user";
export type PlanMode = "hosted" | "local-files" | "self-hosted";

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
  connect?: boolean;
  quiet?: boolean;
  deviceFlowTimeoutMs?: number;
  log?: (message: string) => void;
  isInteractive?: () => boolean;
  telemetry?: CliTelemetry;
  promptSkills?: (context: SkillsPromptContext) => Promise<string[] | null>;
  promptClients?: (
    context: ClientsPromptContext,
  ) => Promise<SkillClient[] | null>;
  promptScope?: (context: ScopePromptContext) => Promise<SkillScope | null>;
  promptUpdateInstructions?: () => Promise<boolean | null>;
  promptGithubAction?: (
    context: GithubActionPromptContext,
  ) => Promise<boolean | null>;
  promptPlanMode?: (context: PlanModePromptContext) => Promise<PlanMode | null>;
  promptPlanMcpUrl?: () => Promise<string | null>;
  /**
   * Register the hosted MCP server for app-backed skills (e.g. visual-plan /
   * visual-recap → the Agent-Native Plan MCP). Defaults to `true`; pass
   * `false` (CLI `--no-mcp`) to install the skill files only.
   */
  mcp?: boolean;
  planMode?: PlanMode;
  mcpUrl?: string;
}

export interface InstalledMcpServer {
  serverName: string;
  mcpUrl: string;
  clients: SkillClient[];
  registeredClients: SkillClient[];
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
  planMode?: PlanMode;
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
  connect: boolean;
  baseDir?: string;
  mcp: boolean;
  planMode?: PlanMode;
  mcpUrl?: string;
}

interface PromptOption<T extends string> {
  value: T;
  label: string;
  hint: string;
}

export interface SkillsPromptContext {
  initialSkills: string[];
  options: Array<PromptOption<string>>;
}

export interface ClientsPromptContext {
  initialClients: SkillClient[];
  options: Array<PromptOption<SkillClient>>;
}

export interface ScopePromptContext {
  initialScope: SkillScope;
}

export interface GithubActionPromptContext {
  workflowPath: string;
}

export interface PlanModePromptContext {
  initialMode: PlanMode;
}

const HELP = `@agent-native/skills

Usage:
  npx @agent-native/skills@latest add [options]
  npx @agent-native/skills@latest list

Options:
  --skill <name>              Install only this skill (repeatable)
  --client, -a <client>       codex, claude-code, or all (default: all; repeatable or comma-separated)
  --scope <user|project>      Install globally or into the current project (default: user)
  -g, --global                Alias for --scope user
  --project                   Alias for --scope project
  --update-instructions       Add managed AGENTS.md / CLAUDE.md instructions when useful
  --no-update-instructions    Skip managed instruction file updates
  --instructions-file <path>  File to receive managed instructions (repeatable)
  --with-github-action        Add .github/workflows/pr-visual-recap.yml when visual-recap is installed
  --mode <mode>               visual-plan/visual-recap mode: hosted, local-files, or self-hosted
  --mcp-url <url>             Self-hosted app/MCP URL for visual-plan/visual-recap
  --force                     Overwrite a different existing PR Visual Recap workflow
  --no-mcp                    Install skill files only; skip registering the app's MCP server
  --no-connect                Register MCP where possible but skip inline browser/device authentication
  -y, --yes                   Use defaults in non-interactive mode
  --dry-run                   Print intended writes without changing files
  --json                      Print the result as JSON

App-backed skills (visual-plan, visual-recap, assets, design-exploration)
register their hosted MCP server in your agent config by default so the agent
can actually use them. Use --no-mcp to skip that and copy the files only.
For visual-plan/visual-recap, choose --mode local-files for no sharing and all
local files, or --mode self-hosted --mcp-url <url> for your own Plan app.

Examples:
  npx @agent-native/skills@latest add
  npx @agent-native/skills@latest add --skill quick-recap
  npx @agent-native/skills@latest add --skill visual-recap --with-github-action
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
    else if ((value = eat("--mode")) !== undefined) {
      out.planMode = parsePlanMode(value);
    } else if ((value = eat("--mcp-url")) !== undefined) {
      out.mcpUrl = value;
    } else if (arg === "--force") out.force = true;
    else if (arg === "--no-mcp") out.mcp = false;
    else if (arg === "--mcp") out.mcp = true;
    else if (arg === "--no-connect" || arg === "--skip-connect")
      out.connect = false;
    else if (arg === "--connect") out.connect = true;
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
  if (out.planMode && out.mcpUrl && out.planMode !== "self-hosted") {
    throw new Error("--mcp-url can only be used with --mode self-hosted.");
  }
  if (out.mcpUrl && !out.planMode) out.planMode = "self-hosted";
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
  if (parsed.skillNames.length === 1) {
    out.push(parsed.skillNames[0]);
  } else if (parsed.skillNames.length > 1) {
    const appIds = unique(
      parsed.skillNames
        .map((name) => resolveAppForSkill(name)?.appId)
        .filter((appId): appId is string => Boolean(appId)),
    );
    if (appIds.length === 1) out.push(appIds[0]);
  } else if (parsed.copySource && parsed.source) out.push(parsed.source);
  if (parsed.clients.length) out.push("--client", parsed.clients.join(","));
  if (parsed.scopeExplicit) out.push("--scope", parsed.scope);
  if (parsed.yes) out.push("--yes");
  if (parsed.dryRun) out.push("--dry-run");
  if (parsed.printJson) out.push("--json");
  if (parsed.withGithubAction) out.push("--with-github-action");
  if (parsed.planMode) out.push("--mode", parsed.planMode);
  if (parsed.mcpUrl) out.push("--mcp-url", parsed.mcpUrl);
  if (parsed.force) out.push("--force");
  if (parsed.mcp === false) out.push("--no-mcp");
  if (parsed.connect === false) out.push("--no-connect");
  if (parsed.updateInstructions === true) out.push("--update-instructions");
  if (parsed.updateInstructions === false) out.push("--no-update-instructions");
  return out;
}

export async function runSkillsCli(
  argv: string[],
  options: Pick<
    InstallSkillsOptions,
    | "log"
    | "isInteractive"
    | "baseDir"
    | "promptSkills"
    | "promptClients"
    | "promptScope"
    | "promptUpdateInstructions"
    | "promptGithubAction"
    | "promptPlanMode"
    | "promptPlanMcpUrl"
  > = {},
): Promise<void> {
  const parsed = parseSkillsCliArgs(argv);

  // PIVOT: `@agent-native/skills` delegates explicitly selected built-in
  // app-backed installs to `@agent-native/core` when using the default source,
  // so app-specific flows like Plan modes stay canonical. The default add/list
  // flow and explicit copied/plain sources stay here so they can install live
  // BuilderIO/skills content and arbitrary skill repos.
  // AGENT_NATIVE_SKILLS_DIRECT=1 (set when core delegates a plain repo back to us)
  // always forces the direct path and breaks the skills → core → skills loop.
  if (process.env.AGENT_NATIVE_SKILLS_DIRECT !== "1") {
    const selectedAppIds = unique(
      parsed.skillNames
        .map((name) => resolveAppForSkill(name)?.appId)
        .filter((appId): appId is string => Boolean(appId)),
    );
    const coreOnlyAppSkills =
      parsed.skillNames.length > 0 &&
      parsed.skillNames.every(
        (name) => resolveAppForSkill(name) !== undefined,
      ) &&
      selectedAppIds.length === 1;
    const defaultSource = !parsed.copySource && !parsed.source;
    if (parsed.command === "add" && coreOnlyAppSkills && defaultSource) {
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

    const stdoutLog =
      parsed.printJson || options.log
        ? options.log
        : (message: string) => process.stdout.write(`${message}\n`);

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
      connect: parsed.connect,
      quiet: parsed.printJson,
      log: parsed.printJson ? undefined : stdoutLog,
      isInteractive: options.isInteractive,
      promptSkills: options.promptSkills,
      promptClients: options.promptClients,
      promptScope: options.promptScope,
      promptUpdateInstructions: options.promptUpdateInstructions,
      promptGithubAction: options.promptGithubAction,
      promptPlanMode: options.promptPlanMode,
      promptPlanMcpUrl: options.promptPlanMcpUrl,
      telemetry,
      mcp: parsed.mcp,
      planMode: parsed.planMode,
      mcpUrl: parsed.mcpUrl,
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

    await printInstallResult(result, {
      baseDir: parsed.baseDir ?? options.baseDir ?? process.cwd(),
      dryRun: parsed.dryRun,
    });
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

    const skillNames = selected.map((skill) => skill.name);
    const planMode = await resolvePlanModeForSkills(skillNames, options);
    const planMcpOverride = await resolvePlanMcpOverrideForMode(
      planMode,
      options,
    );

    const clients = await resolveSelectedClients(options);
    options.telemetry?.track("skills_cli clients selected", {
      clients: clients.join(","),
      clientCount: clients.length,
    });

    const scope = await resolveSelectedScope(options);
    options.telemetry?.track("skills_cli scope selected", { scope });

    const instructionBlocks = managedInstructionBlocksForSkills(skillNames);
    const shouldUpdateInstructions = await shouldUpdateManagedInstructions(
      instructionBlocks,
      options,
    );
    const shouldWriteGithubAction =
      selected.some((skill) => skill.name === "visual-recap") &&
      (options.withGithubAction ||
        (await shouldPromptGithubAction(options, baseDir)));
    const mcpApps =
      options.mcp === false || planMode === "local-files"
        ? []
        : mcpAppsForSkills(skillNames, planMcpOverride);
    const progress = await createInstallProgress(
      options,
      1 +
        (shouldUpdateInstructions ? 1 : 0) +
        (shouldWriteGithubAction ? 1 : 0) +
        mcpApps.length,
    );

    const written: string[] = [];
    let instructionFiles: string[] = [];
    let githubActionPath: string | undefined;
    const mcpServers: InstalledMcpServer[] = [];

    try {
      progress?.start("Installing skill files...");
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
      progress?.advance("Skill files installed");

      options.telemetry?.track("skills_cli install completed", {
        skills: skillNames.join(","),
        clients: clients.join(","),
        scope,
        writtenCount: written.length,
        dryRun: Boolean(options.dryRun),
      });

      if (shouldUpdateInstructions) {
        progress?.message("Updating managed instructions...");
        instructionFiles = writeManagedInstructions(
          instructionBlocks,
          baseDir,
          clients,
          scope,
          options,
        );
        progress?.advance("Managed instructions updated");
        if (instructionFiles.length) {
          options.telemetry?.track("skills_cli instructions updated", {
            fileCount: instructionFiles.length,
          });
        }
      }

      if (shouldWriteGithubAction) {
        progress?.message("Writing PR Visual Recap workflow...");
        githubActionPath = writePrVisualRecapWorkflow(baseDir, options);
        progress?.advance("PR Visual Recap workflow ready");
        if (githubActionPath) {
          options.telemetry?.track("skills_cli github action added");
        }
      }

      // Register the hosted MCP server for app-backed skills (visual-plan /
      // visual-recap → Agent-Native Plan, assets, design-exploration) so the
      // agent can actually call them — not just read the SKILL.md. On by
      // default; `--no-mcp` installs the skill files only. One registration per
      // app, so visual-plan + visual-recap share a single "plan" server.
      if (mcpApps.length > 0) {
        const mcpClients: ClientId[] = clients.map((client) =>
          client === "claude-code" ? "claude-code" : "codex",
        );
        for (const app of mcpApps) {
          progress?.message(`Registering ${app.displayName} MCP server...`);
          if (!options.dryRun) {
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
              interactive: options.connect !== false && isInteractive(options),
              log,
              deviceFlowTimeoutMs: options.deviceFlowTimeoutMs,
            });
            mcpServers.push({
              serverName: app.serverName,
              mcpUrl: app.mcpUrl,
              clients,
              registeredClients: unique(
                registration.written.map(
                  (entry) => entry.client as SkillClient,
                ),
              ),
              files: [
                ...new Set(registration.written.map((entry) => entry.file)),
              ],
              authenticated: registration.authenticated,
              guidance: registration.guidance,
            });
            options.telemetry?.track("skills_cli mcp registered", {
              serverName: app.serverName,
              clients: clients.join(","),
              authenticated: registration.authenticated,
            });
          } else {
            mcpServers.push({
              serverName: app.serverName,
              mcpUrl: app.mcpUrl,
              clients,
              registeredClients: clients,
              files: [],
              authenticated: false,
              guidance: [],
            });
          }
          progress?.advance(`${app.displayName} MCP server ready`);
        }
      }
      progress?.stop("Installation complete");
    } catch (err) {
      progress?.error("Installation failed");
      throw err;
    }

    return {
      source: source.root,
      skills: skillNames,
      clients,
      scope,
      written,
      instructionFiles,
      githubActionPath,
      mcpServers,
      planMode,
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
    connect: true,
    mcp: true,
  };
}

function selectedPlanApp(skillNames: string[]): BuiltInAppMcp | undefined {
  return skillNames
    .map((skillName) => resolveAppForSkill(skillName))
    .find((app): app is BuiltInAppMcp => app?.appId === "visual-plans");
}

async function resolvePlanModeForSkills(
  skillNames: string[],
  options: InstallSkillsOptions,
): Promise<PlanMode | undefined> {
  const includesPlans = Boolean(selectedPlanApp(skillNames));
  if (options.planMode && !includesPlans) {
    throw new Error("--mode only applies to visual-plan / visual-recap.");
  }
  if (options.mcpUrl && !includesPlans) {
    throw new Error("--mcp-url only applies to visual-plan / visual-recap.");
  }
  if (!includesPlans) return undefined;

  if (options.mcpUrl && !options.planMode) return "self-hosted";
  if (options.planMode) return options.planMode;
  if (isInteractive(options) && !options.yes) {
    const prompt = options.promptPlanMode ?? promptForPlanMode;
    const mode = await prompt({ initialMode: "hosted" });
    if (!mode) throw new Error("Cancelled.");
    return mode;
  }
  return "hosted";
}

function resolvePlanMcpUrlOverride(input: string): {
  hostedUrl: string;
  mcpUrl: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`--mcp-url must be a valid URL (got "${input}").`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("--mcp-url must use http:// or https://.");
  }
  const mcpSuffix = "/_agent-native/mcp";
  const trimmedPath = parsed.pathname.replace(/\/+$/, "");
  const appPath = trimmedPath.endsWith(mcpSuffix)
    ? trimmedPath.slice(0, -mcpSuffix.length)
    : trimmedPath;
  const mcpPath = trimmedPath.endsWith(mcpSuffix)
    ? trimmedPath
    : `${trimmedPath || ""}${mcpSuffix}`;
  return {
    hostedUrl: `${parsed.origin}${appPath}`,
    mcpUrl: `${parsed.origin}${mcpPath}`,
  };
}

async function resolvePlanMcpOverrideForMode(
  planMode: PlanMode | undefined,
  options: InstallSkillsOptions,
): Promise<{ hostedUrl: string; mcpUrl: string } | undefined> {
  if (planMode === "local-files" && options.mcpUrl) {
    throw new Error("--mode local-files cannot be combined with --mcp-url.");
  }
  if (planMode !== "self-hosted") return undefined;
  let mcpUrl = options.mcpUrl;
  if (!mcpUrl && isInteractive(options) && !options.yes) {
    const prompt = options.promptPlanMcpUrl ?? promptForPlanMcpUrl;
    mcpUrl = (await prompt()) ?? undefined;
  }
  if (!mcpUrl) {
    throw new Error(
      "--mode self-hosted requires --mcp-url <url> in non-interactive mode.",
    );
  }
  return resolvePlanMcpUrlOverride(mcpUrl);
}

function parsePlanMode(value: string): PlanMode {
  if (value === "hosted" || value === "local-files" || value === "self-hosted")
    return value;
  throw new Error('--mode must be "hosted", "local-files", or "self-hosted".');
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

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function shortenPathForOutput(file: string, baseDir: string): string {
  const resolved = path.resolve(file);
  const home = process.env.HOME || os.homedir();
  if (resolved === home || resolved.startsWith(`${home}${path.sep}`)) {
    return `~${resolved.slice(home.length)}`;
  }
  const base = path.resolve(baseDir);
  const relative = path.relative(base, resolved);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `.${path.sep}${relative}`;
  }
  return file;
}

function summarizePaths(files: string[], baseDir: string, max = 4): string {
  const shortened = unique(files).map((file) =>
    shortenPathForOutput(file, baseDir),
  );
  if (shortened.length <= max) return shortened.join(", ");
  return `${shortened.slice(0, max).join(", ")} +${shortened.length - max} more`;
}

async function createInstallProgress(
  options: InstallSkillsOptions,
  max: number,
) {
  if (options.quiet || !isInteractive(options) || max <= 0) return null;
  const clack = await import("@clack/prompts");
  const progress = clack.progress({ max, indicator: "timer" });
  let active = false;
  return {
    start(message: string) {
      active = true;
      progress.start(message);
    },
    message(message: string) {
      if (active) progress.message(message);
    },
    advance(message: string) {
      if (active) progress.advance(1, message);
    },
    stop(message: string) {
      if (!active) return;
      progress.stop(message);
      active = false;
    },
    error(message: string) {
      if (!active) return;
      progress.error(message);
      active = false;
    },
  };
}

function mcpAppsForSkills(
  skillNames: string[],
  planOverride?: { hostedUrl: string; mcpUrl: string },
): BuiltInAppMcp[] {
  const apps: BuiltInAppMcp[] = [];
  const seen = new Set<string>();
  for (const skillName of skillNames) {
    const app = resolveAppForSkill(skillName);
    if (!app || seen.has(app.appId)) continue;
    seen.add(app.appId);
    if (app.appId === "visual-plans" && planOverride) {
      apps.push({
        ...app,
        hostedUrl: planOverride.hostedUrl,
        mcpUrl: planOverride.mcpUrl,
      });
    } else {
      apps.push(app);
    }
  }
  return apps;
}

function mcpStatus(server: InstalledMcpServer, dryRun: boolean): string {
  if (dryRun) return `would register for ${server.clients.join(", ")}`;

  const registered = server.registeredClients;
  const pending = server.clients.filter(
    (client) => !registered.includes(client),
  );
  const parts: string[] = [];
  if (registered.length > 0) {
    parts.push(
      `${server.authenticated ? "registered and authenticated" : "registered"} for ${registered.join(", ")}`,
    );
  }
  if (pending.length > 0) {
    parts.push(`authentication pending for ${pending.join(", ")}`);
  }
  return (
    parts.join("; ") ||
    `authentication pending for ${server.clients.join(", ")}`
  );
}

async function printInstallResult(
  result: InstallSkillsResult,
  options: { baseDir: string; dryRun: boolean },
): Promise<void> {
  const clack = await import("@clack/prompts");
  const verb = options.dryRun ? "Would install" : "Installed";
  const summary = [
    `Skills        ${result.skills.join(", ") || "none"}`,
    `Agents        ${result.clients.join(", ") || "none"}`,
    `Scope         ${result.scope}`,
    result.planMode ? `Plan mode     ${result.planMode}` : "",
    result.written.length
      ? `Skill folders ${plural(result.written.length, "folder")} (${summarizePaths(
          result.written,
          options.baseDir,
        )})`
      : "",
  ].filter(Boolean);

  clack.note(summary.join("\n"), verb);

  if (result.instructionFiles.length) {
    clack.note(
      summarizePaths(result.instructionFiles, options.baseDir),
      "Managed instructions",
    );
  }

  if (result.githubActionPath) {
    clack.note(
      shortenPathForOutput(result.githubActionPath, options.baseDir),
      "PR Visual Recap workflow",
    );
  }

  if (result.mcpServers.length) {
    const mcpLines = result.mcpServers.map((server) => {
      const status = mcpStatus(server, options.dryRun);
      const files = server.files.length
        ? ` (${summarizePaths(server.files, options.baseDir, 2)})`
        : "";
      return `${server.serverName}: ${status}${files}`;
    });
    clack.note(mcpLines.join("\n"), "MCP");

    const guidance = result.mcpServers.flatMap((server) => server.guidance);
    if (guidance.length) {
      clack.note(guidance.join("\n"), "Next steps");
    }
  }

  if (result.planMode === "local-files") {
    clack.note(
      [
        "No sharing, all local.",
        "Run: npx @agent-native/core@latest plan blocks --out plan-blocks.md",
        "Preview: npx @agent-native/core@latest plan local preview --dir plans/<slug>",
      ].join("\n"),
      "Local Plan files",
    );
  }

  if (!options.dryRun) {
    clack.note("Restart or reload selected agent clients if needed.", "Reload");
  }

  clack.outro(`${options.dryRun ? "Dry run complete" : "All set"} ✅`);
}

function compactPromptHint(value: string | undefined): string {
  const hint = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!hint) return "Skill from BuilderIO/skills.";
  if (hint.length <= 96) return hint;
  return `${hint.slice(0, 93).trimEnd()}...`;
}

function skillPromptOptions(
  entries: SkillEntry[],
): SkillsPromptContext["options"] {
  return entries.map((entry) => ({
    value: entry.name,
    label: entry.name,
    hint: compactPromptHint(entry.description),
  }));
}

async function promptForSkills(
  context: SkillsPromptContext,
): Promise<string[] | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.multiselect({
    message:
      "Which skills do you want to install?\n" +
      "  (space toggles, enter confirms)",
    options: context.options,
    initialValues: context.initialSkills,
    required: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  if (!Array.isArray(result)) return [];
  return result.filter((value): value is string => typeof value === "string");
}

async function promptForPlanMode(
  context: PlanModePromptContext,
): Promise<PlanMode | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.select({
    message: "How should visual-plan / visual-recap run?",
    options: [
      {
        value: "hosted",
        label: "Hosted",
        hint: "Shareable Plan app with MCP tools, auth, comments, and hosted storage.",
      },
      {
        value: "local-files",
        label: "Local files",
        hint: "No sharing, all local. Installs text skills and skips MCP/auth.",
      },
      {
        value: "self-hosted",
        label: "Self-hosted",
        hint: "Use your own deployed Plan app MCP URL.",
      },
    ],
    initialValue: context.initialMode,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return typeof result === "string" ? parsePlanMode(result) : null;
}

async function promptForPlanMcpUrl(): Promise<string | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.text({
    message: "What is your self-hosted Plan app or MCP URL?",
    placeholder: "https://plans.example.com",
    validate(value) {
      try {
        resolvePlanMcpUrlOverride(String(value));
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return typeof result === "string" ? result : null;
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

  const prompt = options.promptSkills ?? promptForSkills;
  const selectedNames = await prompt({
    initialSkills: entries.map((entry) => entry.name),
    options: skillPromptOptions(entries),
  });
  if (!selectedNames || selectedNames.length === 0) {
    throw new Error("Cancelled.");
  }
  return resolveSelectedSkills(entries, {
    ...options,
    skillNames: selectedNames,
  });
}

async function promptForScope(
  context: ScopePromptContext,
): Promise<SkillScope | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.select({
    message: "Where do you want to install these skills?",
    options: [
      {
        value: "project",
        label: "Project",
        hint: "This repo only (.agents / .claude in the current directory)",
      },
      {
        value: "user",
        label: "User",
        hint: "Your home directory (~/.codex, ~/.claude), across projects",
      },
    ],
    initialValue: context.initialScope,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return result === "user" ? "user" : "project";
}

async function resolveSelectedScope(
  options: InstallSkillsOptions,
): Promise<SkillScope> {
  if (options.scope) return options.scope;
  if (!isInteractive(options) || options.yes) return "user";

  const prompt = options.promptScope ?? promptForScope;
  const selected = await prompt({ initialScope: "project" });
  if (!selected) throw new Error("Cancelled.");
  return selected;
}

function clientPromptOptions(): ClientsPromptContext["options"] {
  return [
    {
      value: "codex",
      label: "Codex",
      hint: "Install into Codex skill directories",
    },
    {
      value: "claude-code",
      label: "Claude Code",
      hint: "Install into Claude Code skill directories",
    },
  ];
}

function normalizePromptClients(values: unknown): SkillClient[] {
  if (!Array.isArray(values)) return [];
  return unique(
    values.filter(
      (value): value is SkillClient =>
        value === "codex" || value === "claude-code",
    ),
  );
}

async function promptForClients(
  context: ClientsPromptContext,
): Promise<SkillClient[] | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.multiselect({
    message:
      "Install these skills for which local agents?\n" +
      "  (space toggles, enter confirms)",
    options: context.options,
    initialValues: context.initialClients,
    required: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Cancelled.");
    return null;
  }
  return normalizePromptClients(result);
}

async function resolveSelectedClients(
  options: InstallSkillsOptions,
): Promise<SkillClient[]> {
  const requested = unique(options.clients ?? []);
  if (requested.length > 0) return requested;
  if (!isInteractive(options) || options.yes) return CLIENTS;

  const prompt = options.promptClients ?? promptForClients;
  const selected = await prompt({
    initialClients: CLIENTS,
    options: clientPromptOptions(),
  });
  if (!selected || selected.length === 0) throw new Error("Cancelled.");
  return selected;
}

function isInteractive(
  options: Pick<InstallSkillsOptions, "isInteractive">,
): boolean {
  if (options.isInteractive) return options.isInteractive();
  if (process.env.CI === "true") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
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
  const name = frontmatterField(frontmatter?.[1], "name") ?? path.basename(dir);
  const description = frontmatterField(frontmatter?.[1], "description");
  return { name: normalizeSkillName(name), dir, description };
}

function frontmatterField(
  frontmatter: string | undefined,
  field: string,
): string | undefined {
  if (!frontmatter) return undefined;
  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(new RegExp(`^${field}:\\s*(.*)$`));
    if (!match) continue;
    const raw = match[1].trim();
    if (raw === ">-" || raw === ">" || raw === "|-" || raw === "|") {
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim() && !/^\s/.test(line)) break;
        block.push(line.replace(/^\s+/, ""));
      }
      const value = raw.startsWith("|") ? block.join("\n") : block.join(" ");
      return value.replace(/\s+/g, " ").trim() || undefined;
    }
    return raw.replace(/^["']|["']$/g, "").trim() || undefined;
  }
  return undefined;
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

function managedInstructionBlocksForSkills(skillNames: string[]): string[] {
  return skillNames
    .map((name) => instructionContentForSkill(name))
    .filter((block): block is string => Boolean(block));
}

async function shouldUpdateManagedInstructions(
  blocks: string[],
  options: InstallSkillsOptions,
): Promise<boolean> {
  if (blocks.length === 0) return false;
  let shouldUpdate = options.updateInstructions;
  if (shouldUpdate !== undefined) return shouldUpdate;
  if (options.yes) return true;
  if (!isInteractive(options)) return false;
  const prompt =
    options.promptUpdateInstructions ?? promptForUpdateInstructions;
  return (await prompt()) === true;
}

function writeManagedInstructions(
  blocks: string[],
  baseDir: string,
  clients: SkillClient[],
  scope: SkillScope,
  options: InstallSkillsOptions,
): string[] {
  if (blocks.length === 0) return [];
  const files = resolveInstructionFiles(
    baseDir,
    options.instructionFiles,
    clients,
    scope,
  );
  const content = `${MANAGED_INSTRUCTIONS_START}
${blocks.join("\n")}
${MANAGED_INSTRUCTIONS_END}`;
  for (const file of files) {
    if (options.dryRun) continue;
    upsertManagedBlock(file, content);
  }
  return files;
}

async function maybeUpdateInstructions(
  skillNames: string[],
  baseDir: string,
  options: InstallSkillsOptions,
): Promise<string[]> {
  const blocks = managedInstructionBlocksForSkills(skillNames);
  const clients = options.clients?.length ? options.clients : CLIENTS;
  const scope = options.scope ?? "user";
  if (!(await shouldUpdateManagedInstructions(blocks, options))) return [];
  return writeManagedInstructions(blocks, baseDir, clients, scope, options);
}

function resolveInstructionFiles(
  baseDir: string,
  explicit: string[] | undefined,
  clients: SkillClient[],
  scope: SkillScope,
): string[] {
  if (explicit && explicit.length > 0) {
    return explicit.map((file) => path.resolve(baseDir, file));
  }
  if (scope === "user") {
    const home = process.env.HOME || os.homedir();
    const files: string[] = [];
    if (clients.includes("codex")) {
      const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
      files.push(path.join(codexHome, "AGENTS.md"));
    }
    if (clients.includes("claude-code")) {
      files.push(path.join(home, ".claude", "CLAUDE.md"));
    }
    return unique(files);
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
  const prompt = options.promptGithubAction ?? promptForGithubAction;
  return (
    (await prompt({
      workflowPath: path.join(".github", "workflows", "pr-visual-recap.yml"),
    })) === true
  );
}

async function promptForUpdateInstructions(): Promise<boolean | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.confirm({
    message:
      "Add managed AGENTS.md / CLAUDE.md instructions for always-on behavior?",
    initialValue: true,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Skipped instruction update.");
    return null;
  }
  return Boolean(result);
}

async function promptForGithubAction(
  context: GithubActionPromptContext,
): Promise<boolean | null> {
  const clack = await import("@clack/prompts");
  const result = await clack.confirm({
    message:
      "Optional: add automatic PR Visual Recaps? (GitHub Action)\n" +
      "  Posts a human-friendly recap on every pull request.\n" +
      `  Writes ${context.workflowPath}.`,
    initialValue: false,
  });
  if (clack.isCancel(result)) {
    clack.cancel("Skipped PR Visual Recap workflow.");
    return null;
  }
  return Boolean(result);
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
