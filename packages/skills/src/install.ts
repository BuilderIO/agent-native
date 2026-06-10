import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

export type AgentId = "codex" | "claude";
export type Scope = "project" | "user";
type Command = "add" | "list" | "help";
type InstructionTarget = "agents" | "claude";

export const MANAGED_BLOCK_START =
  "<!-- BEGIN @agent-native/skills managed block -->";
export const MANAGED_BLOCK_END =
  "<!-- END @agent-native/skills managed block -->";

export const HELP = `skills

Usage:
  skills list <source> [--json]
  skills add <source> [--skill <name> ...|--all] [--agent codex|claude|all] [--scope user|project] [--project <dir>] [--instructions agents|claude|both] [--yes] [--force] [--dry-run] [--json]

Sources:
  ./skills
  ./skills/my-skill
  owner/repo
  owner/repo/path/to/skills#ref
  github:owner/repo/path/to/skills#ref
  https://github.com/owner/repo/tree/ref/path/to/skills

Targets:
  project codex  -> <project>/.agents/skills
  project claude -> <project>/.claude/skills
  user codex     -> $CODEX_HOME/skills or ~/.codex/skills
  user claude    -> ~/.claude/skills

Options:
  -s, --skill <name>        Install one skill. Repeat or comma-separate.
      --all                 Install every discovered skill.
  -a, --agent <target>      codex, claude, or all. Defaults to codex.
      --scope <scope>       user or project. Defaults to user.
      --project <dir>       Project root for project-scoped installs.
      --ref <git-ref>       Git ref for GitHub-style sources.
      --instructions <set>  agents, claude, both/all, or none.
      --with-agents-md      Append/update the AGENTS.md managed block.
      --with-claude-md      Append/update the CLAUDE.md managed block.
      --agents-file <path>  Override the AGENTS.md path.
      --claude-file <path>  Override the CLAUDE.md path.
  -y, --yes                 Accept prompts.
      --force               Overwrite existing skill folders.
      --dry-run             Print what would change.
      --json                Print machine-readable output.`;

export interface ParsedSkillsCliArgs {
  command: Command;
  source?: string;
  skills: string[];
  all: boolean;
  agents: AgentId[];
  scope: Scope;
  projectDir: string;
  ref?: string;
  instructionTargets: InstructionTarget[];
  agentsFile: string;
  claudeFile: string;
  yes: boolean;
  force: boolean;
  dryRun: boolean;
  json: boolean;
}

export interface DiscoveredSkill {
  name: string;
  dir: string;
  description?: string;
}

export interface GitHubSource {
  cloneUrl: string;
  ref?: string;
  subdir: string;
  display: string;
}

interface ResolvedSource {
  root: string;
  display: string;
  cleanup: () => void;
}

interface TargetRoot {
  agent: AgentId;
  scope: Scope;
  root: string;
}

interface CopiedSkill {
  skillName: string;
  agent: AgentId;
  scope: Scope;
  from: string;
  to: string;
}

export interface InstallResult {
  source: string;
  dryRun: boolean;
  skills: string[];
  copied: CopiedSkill[];
  instructionFiles: string[];
}

interface RunCommandOptions {
  cwd?: string;
}

export interface RunSkillsCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  isInteractive?: () => boolean;
  log?: (message: string) => void;
  promptSkills?: (skills: DiscoveredSkill[]) => Promise<string[] | null>;
  promptOverwrite?: (paths: string[]) => Promise<boolean>;
  runCommand?: (
    cmd: string,
    args: string[],
    options?: RunCommandOptions,
  ) => Promise<number>;
}

function valueFor(
  args: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } | null {
  const arg = args[index];
  if (arg === flag) {
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
      throw new Error(`Missing value for ${flag}.`);
    }
    return { value, nextIndex: index + 1 };
  }
  if (arg.startsWith(`${flag}=`)) {
    const value = arg.slice(flag.length + 1);
    if (!value) throw new Error(`Missing value for ${flag}.`);
    return { value, nextIndex: index };
  }
  return null;
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeAgent(value: string): AgentId[] {
  const out: AgentId[] = [];
  for (const part of splitList(value)) {
    const key = part.toLowerCase();
    if (key === "all") {
      out.push("codex", "claude");
    } else if (key === "codex") {
      out.push("codex");
    } else if (key === "claude" || key === "claude-code") {
      out.push("claude");
    } else {
      throw new Error(
        `Unknown agent "${part}". Expected codex, claude, or all.`,
      );
    }
  }
  return [...new Set(out)];
}

function normalizeInstructions(value: string): InstructionTarget[] {
  const key = value.trim().toLowerCase();
  if (key === "none") return [];
  if (key === "agents" || key === "agents.md" || key === "agent") {
    return ["agents"];
  }
  if (key === "claude" || key === "claude.md") return ["claude"];
  if (key === "both" || key === "all") return ["agents", "claude"];
  throw new Error(
    `Unknown instructions target "${value}". Expected agents, claude, both, or none.`,
  );
}

function pushUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

export function parseSkillsCliArgs(
  argv: string[],
  cwd = process.cwd(),
): ParsedSkillsCliArgs {
  const first = argv[0];
  let command: Command = "add";
  let args = argv;
  if (!first || first === "help" || first === "--help" || first === "-h") {
    command = "help";
    args = argv.slice(first ? 1 : 0);
  } else if (first === "add" || first === "list") {
    command = first;
    args = argv.slice(1);
  }

  const parsed: ParsedSkillsCliArgs = {
    command,
    skills: [],
    all: false,
    agents: ["codex"],
    scope: "user",
    projectDir: cwd,
    instructionTargets: [],
    agentsFile: "AGENTS.md",
    claudeFile: "CLAUDE.md",
    yes: false,
    force: false,
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let consumed: { value: string; nextIndex: number } | null;
    if (
      (consumed = valueFor(args, i, "--skill")) ||
      (consumed = valueFor(args, i, "-s"))
    ) {
      for (const skill of splitList(consumed.value)) parsed.skills.push(skill);
      i = consumed.nextIndex;
    } else if (
      (consumed = valueFor(args, i, "--agent")) ||
      (consumed = valueFor(args, i, "-a"))
    ) {
      parsed.agents = normalizeAgent(consumed.value);
      i = consumed.nextIndex;
    } else if ((consumed = valueFor(args, i, "--scope"))) {
      if (consumed.value !== "user" && consumed.value !== "project") {
        throw new Error("--scope must be either user or project.");
      }
      parsed.scope = consumed.value;
      i = consumed.nextIndex;
    } else if ((consumed = valueFor(args, i, "--project"))) {
      parsed.projectDir = path.resolve(cwd, consumed.value);
      i = consumed.nextIndex;
    } else if ((consumed = valueFor(args, i, "--ref"))) {
      parsed.ref = consumed.value;
      i = consumed.nextIndex;
    } else if ((consumed = valueFor(args, i, "--instructions"))) {
      parsed.instructionTargets = normalizeInstructions(consumed.value);
      i = consumed.nextIndex;
    } else if ((consumed = valueFor(args, i, "--agents-file"))) {
      parsed.agentsFile = consumed.value;
      pushUnique(parsed.instructionTargets, "agents");
      i = consumed.nextIndex;
    } else if ((consumed = valueFor(args, i, "--claude-file"))) {
      parsed.claudeFile = consumed.value;
      pushUnique(parsed.instructionTargets, "claude");
      i = consumed.nextIndex;
    } else if (arg === "--with-agents-md") {
      pushUnique(parsed.instructionTargets, "agents");
    } else if (arg === "--with-claude-md") {
      pushUnique(parsed.instructionTargets, "claude");
    } else if (arg === "--all") {
      parsed.all = true;
    } else if (arg === "--global") {
      parsed.scope = "user";
    } else if (arg === "--project-scope") {
      parsed.scope = "project";
    } else if (arg === "--yes" || arg === "-y") {
      parsed.yes = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!parsed.source) {
      parsed.source = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  parsed.skills = [...new Set(parsed.skills)];
  parsed.agents = [...new Set(parsed.agents)];
  return parsed;
}

function stripGitSuffix(value: string): string {
  return value.endsWith(".git") ? value.slice(0, -4) : value;
}

function parsePathGitHubSource(
  input: string,
  ref?: string,
): GitHubSource | null {
  const hashIndex = input.indexOf("#");
  const withoutHash = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const hashRef = hashIndex >= 0 ? input.slice(hashIndex + 1) : undefined;
  const raw = withoutHash.startsWith("github:")
    ? withoutHash.slice("github:".length)
    : withoutHash;
  if (/^[./~]/.test(raw)) return null;
  const parts = raw.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  if (!/^[A-Za-z0-9_.-]+$/.test(parts[0])) return null;
  if (!/^[A-Za-z0-9_.-]+(?:\.git)?$/.test(parts[1])) return null;
  const owner = parts[0];
  const repo = stripGitSuffix(parts[1]);
  const subdir = parts.slice(2).join("/");
  return {
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    ref: ref ?? hashRef,
    subdir,
    display: `github:${owner}/${repo}${subdir ? `/${subdir}` : ""}${
      (ref ?? hashRef) ? `#${ref ?? hashRef}` : ""
    }`,
  };
}

export function parseGitHubSource(
  input: string,
  ref?: string,
): GitHubSource | null {
  if (input.startsWith("git@github.com:")) {
    const withoutPrefix = input.slice("git@github.com:".length);
    return parsePathGitHubSource(withoutPrefix, ref);
  }

  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    return parsePathGitHubSource(input, ref);
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
  const owner = parts[0];
  const repo = stripGitSuffix(parts[1]);
  let sourceRef = ref ?? (url.hash ? url.hash.slice(1) : undefined);
  let subdir = "";
  if (parts[2] === "tree" || parts[2] === "blob") {
    sourceRef = ref ?? parts[3] ?? sourceRef;
    subdir = parts.slice(4).join("/");
  } else {
    subdir = parts.slice(2).join("/");
  }
  return {
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    ref: sourceRef,
    subdir,
    display: `github:${owner}/${repo}${subdir ? `/${subdir}` : ""}${
      sourceRef ? `#${sourceRef}` : ""
    }`,
  };
}

function runCommand(
  cmd: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${cmd} interrupted by ${signal}.`));
      else resolve(code ?? 0);
    });
  });
}

async function resolveSource(
  source: string,
  parsed: ParsedSkillsCliArgs,
  options: RunSkillsCliOptions,
): Promise<ResolvedSource> {
  const local = path.resolve(options.cwd ?? process.cwd(), source);
  if (fs.existsSync(local)) {
    return { root: local, display: source, cleanup: () => {} };
  }

  const github = parseGitHubSource(source, parsed.ref);
  if (!github) {
    throw new Error(
      `Source does not exist and is not a GitHub source: ${source}`,
    );
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "an-skills-"));
  const repoDir = path.join(tmpRoot, "repo");
  const args = ["clone", "--depth", "1"];
  if (github.ref) args.push("--branch", github.ref);
  args.push(github.cloneUrl, repoDir);
  const code = await (options.runCommand ?? runCommand)("git", args);
  if (code !== 0) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    throw new Error(`git clone exited with ${code}.`);
  }

  const root = github.subdir ? path.join(repoDir, github.subdir) : repoDir;
  if (!fs.existsSync(root)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    throw new Error(`GitHub source path not found: ${github.subdir}`);
  }
  return {
    root,
    display: github.display,
    cleanup: () => fs.rmSync(tmpRoot, { recursive: true, force: true }),
  };
}

function parseFrontmatterField(
  content: string,
  field: string,
): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const fieldMatch = match[1].match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  if (!fieldMatch) return undefined;
  return fieldMatch[1].trim().replace(/^['"]|['"]$/g, "");
}

function safeSkillName(value: string): string {
  const name = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid skill name "${value}".`);
  }
  return name;
}

function skillFromDir(dir: string): DiscoveredSkill | null {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf-8");
  return {
    name: safeSkillName(
      parseFrontmatterField(content, "name") ?? path.basename(dir),
    ),
    description: parseFrontmatterField(content, "description"),
    dir,
  };
}

function addSkillDir(
  out: DiscoveredSkill[],
  seen: Set<string>,
  dir: string,
): void {
  const skill = skillFromDir(dir);
  if (!skill) return;
  const key = `${skill.name}:${path.resolve(skill.dir)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(skill);
}

export function discoverSkillFolders(root: string): DiscoveredSkill[] {
  const out: DiscoveredSkill[] = [];
  const seen = new Set<string>();
  addSkillDir(out, seen, root);

  const containers = [
    path.join(root, "skills"),
    path.join(root, ".agents", "skills"),
    path.join(root, ".claude", "skills"),
    root,
  ];

  for (const container of containers) {
    if (!fs.existsSync(container)) continue;
    const stat = fs.statSync(container);
    if (!stat.isDirectory()) continue;
    for (const entry of fs.readdirSync(container, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      addSkillDir(out, seen, path.join(container, entry.name));
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME || os.homedir();
}

export function targetRootsFor(input: {
  agents: AgentId[];
  scope: Scope;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
}): TargetRoot[] {
  const env = input.env ?? process.env;
  const roots: TargetRoot[] = [];
  for (const agent of input.agents) {
    if (input.scope === "project") {
      roots.push({
        agent,
        scope: "project",
        root:
          agent === "codex"
            ? path.join(input.projectDir, ".agents", "skills")
            : path.join(input.projectDir, ".claude", "skills"),
      });
    } else if (agent === "codex") {
      roots.push({
        agent,
        scope: "user",
        root: env.CODEX_HOME
          ? path.join(env.CODEX_HOME, "skills")
          : path.join(homeDir(env), ".codex", "skills"),
      });
    } else {
      roots.push({
        agent,
        scope: "user",
        root: path.join(homeDir(env), ".claude", "skills"),
      });
    }
  }
  return roots;
}

function shouldPrompt(
  options: RunSkillsCliOptions,
  parsed: ParsedSkillsCliArgs,
) {
  if (parsed.yes || parsed.json) return false;
  if (options.isInteractive) return options.isInteractive();
  if (process.env.CI === "true") return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function promptForSkills(
  skills: DiscoveredSkill[],
): Promise<string[] | null> {
  process.stdout.write("Select skills to install:\n");
  skills.forEach((skill, index) => {
    const suffix = skill.description ? ` - ${skill.description}` : "";
    process.stdout.write(`  ${index + 1}. ${skill.name}${suffix}\n`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "Enter numbers or names separated by commas, or all: ",
    );
    const trimmed = answer.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === "all")
      return skills.map((skill) => skill.name);
    const selected: string[] = [];
    for (const part of splitList(trimmed)) {
      const index = Number(part);
      if (Number.isInteger(index) && index >= 1 && index <= skills.length) {
        selected.push(skills[index - 1].name);
      } else {
        selected.push(part);
      }
    }
    return selected;
  } finally {
    rl.close();
  }
}

async function promptForOverwrite(paths: string[]): Promise<boolean> {
  process.stdout.write("Existing skill folders will be overwritten:\n");
  for (const target of paths) process.stdout.write(`  ${target}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Overwrite? [y/N] ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

async function selectSkills(
  discovered: DiscoveredSkill[],
  parsed: ParsedSkillsCliArgs,
  options: RunSkillsCliOptions,
): Promise<DiscoveredSkill[]> {
  if (discovered.length === 0) {
    throw new Error("No skill folders found. Expected folders with SKILL.md.");
  }
  let names = parsed.skills;
  if (parsed.all) {
    names = discovered.map((skill) => skill.name);
  } else if (names.length === 0 && discovered.length === 1) {
    names = [discovered[0].name];
  } else if (names.length === 0 && shouldPrompt(options, parsed)) {
    const picked = await (options.promptSkills ?? promptForSkills)(discovered);
    if (!picked || picked.length === 0) throw new Error("No skills selected.");
    names = picked;
  } else if (names.length === 0) {
    throw new Error(
      "Multiple skills found. Pass --skill <name>, --all, or run interactively.",
    );
  }

  const byName = new Map(discovered.map((skill) => [skill.name, skill]));
  return names.map((name) => {
    const skill = byName.get(name);
    if (!skill) {
      throw new Error(
        `Skill "${name}" not found. Available: ${discovered
          .map((item) => item.name)
          .join(", ")}`,
      );
    }
    return skill;
  });
}

function assertWithin(root: string, target: string): void {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing to write outside target root: ${target}`);
  }
}

function copySkillDir(from: string, to: string, dryRun: boolean): void {
  if (dryRun) return;
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter(source) {
      const base = path.basename(source);
      return base !== ".git" && base !== "node_modules";
    },
  });
}

function instructionFilePath(
  projectDir: string,
  target: InstructionTarget,
  parsed: ParsedSkillsCliArgs,
): string {
  const file = target === "agents" ? parsed.agentsFile : parsed.claudeFile;
  return path.isAbsolute(file) ? file : path.join(projectDir, file);
}

function buildManagedBlock(input: {
  skills: DiscoveredSkill[];
  source: string;
  roots: TargetRoot[];
}): string {
  const agentText = [...new Set(input.roots.map((root) => root.agent))].join(
    ", ",
  );
  const scopeText = [...new Set(input.roots.map((root) => root.scope))].join(
    ", ",
  );
  const skillLines = input.skills
    .map((skill) => `- \`${skill.name}\``)
    .join("\n");
  return `${MANAGED_BLOCK_START}
## Installed Agent Skills

This block is managed by \`@agent-native/skills\`. Re-run the installer to update
it.

Source: \`${input.source}\`
Agents: ${agentText}
Scope: ${scopeText}

${skillLines}
${MANAGED_BLOCK_END}
`;
}

export function upsertManagedBlock(
  file: string,
  block: string,
  dryRun = false,
): boolean {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  const start = current.indexOf(MANAGED_BLOCK_START);
  const end = current.indexOf(MANAGED_BLOCK_END);
  let next: string;
  if (start >= 0 && end >= start) {
    const afterEnd = end + MANAGED_BLOCK_END.length;
    next = `${current.slice(0, start).trimEnd()}\n\n${block.trimEnd()}\n${current
      .slice(afterEnd)
      .trimStart()}`;
  } else {
    next = `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block.trimEnd()}\n`;
  }
  if (next === current) return false;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next, "utf-8");
  }
  return true;
}

export async function installSkills(
  parsed: ParsedSkillsCliArgs,
  options: RunSkillsCliOptions = {},
): Promise<InstallResult> {
  if (!parsed.source) throw new Error("Missing source.");
  const source = await resolveSource(parsed.source, parsed, options);
  try {
    const discovered = discoverSkillFolders(source.root);
    const selected = await selectSkills(discovered, parsed, options);
    const roots = targetRootsFor({
      agents: parsed.agents,
      scope: parsed.scope,
      projectDir: parsed.projectDir,
      env: options.env,
    });

    const existing: string[] = [];
    for (const root of roots) {
      for (const skill of selected) {
        const dest = path.join(root.root, safeSkillName(skill.name));
        assertWithin(root.root, dest);
        if (fs.existsSync(dest)) existing.push(dest);
      }
    }
    if (existing.length > 0 && !parsed.force && !parsed.yes && !parsed.dryRun) {
      if (!shouldPrompt(options, parsed)) {
        throw new Error(
          `Refusing to overwrite existing skill folders without --force: ${existing.join(
            ", ",
          )}`,
        );
      }
      const ok = await (options.promptOverwrite ?? promptForOverwrite)(
        existing,
      );
      if (!ok) throw new Error("Install cancelled.");
    }

    const copied: CopiedSkill[] = [];
    for (const root of roots) {
      for (const skill of selected) {
        const dest = path.join(root.root, safeSkillName(skill.name));
        assertWithin(root.root, dest);
        copySkillDir(skill.dir, dest, parsed.dryRun);
        copied.push({
          skillName: skill.name,
          agent: root.agent,
          scope: root.scope,
          from: skill.dir,
          to: dest,
        });
      }
    }

    const instructionFiles: string[] = [];
    if (parsed.instructionTargets.length > 0) {
      const block = buildManagedBlock({
        skills: selected,
        source: source.display,
        roots,
      });
      for (const target of parsed.instructionTargets) {
        const file = instructionFilePath(parsed.projectDir, target, parsed);
        upsertManagedBlock(file, block, parsed.dryRun);
        instructionFiles.push(file);
      }
    }

    return {
      source: source.display,
      dryRun: parsed.dryRun,
      skills: selected.map((skill) => skill.name),
      copied,
      instructionFiles,
    };
  } finally {
    source.cleanup();
  }
}

function formatList(skills: DiscoveredSkill[]): string {
  if (skills.length === 0) return "No skill folders found.\n";
  return skills
    .map((skill) => {
      const suffix = skill.description ? ` - ${skill.description}` : "";
      return `${skill.name}${suffix}\n  ${skill.dir}`;
    })
    .join("\n");
}

function formatInstallResult(result: InstallResult): string {
  const verb = result.dryRun ? "Would install" : "Installed";
  const rows = result.copied.map(
    (item) => `  ${item.skillName} -> ${item.to} (${item.agent}/${item.scope})`,
  );
  const instructions =
    result.instructionFiles.length > 0
      ? `\nUpdated managed instruction blocks:\n${result.instructionFiles
          .map((file) => `  ${file}`)
          .join("\n")}`
      : "";
  return `${verb} ${result.skills.length} skill${
    result.skills.length === 1 ? "" : "s"
  } from ${result.source}:\n${rows.join("\n")}${instructions}\n`;
}

export async function runSkillsCli(
  argv: string[],
  options: RunSkillsCliOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseSkillsCliArgs(argv, cwd);
  const write =
    options.log ?? ((message: string) => process.stdout.write(message));

  if (parsed.command === "help") {
    write(`${HELP}\n`);
    return;
  }

  if (!parsed.source) throw new Error("Missing source.");

  if (parsed.command === "list") {
    const source = await resolveSource(parsed.source, parsed, options);
    try {
      const skills = discoverSkillFolders(source.root);
      if (parsed.json) {
        write(
          `${JSON.stringify({ source: source.display, skills }, null, 2)}\n`,
        );
      } else {
        write(`${formatList(skills)}\n`);
      }
    } finally {
      source.cleanup();
    }
    return;
  }

  const result = await installSkills(parsed, options);
  if (parsed.json) {
    write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    write(formatInstallResult(result));
  }
}
