import fs from "fs";
import path from "path";
import {
  normalizeSkillScope,
  type SkillScope,
} from "../server/agents-bundle.js";

export interface CodeAgentProjectCommand {
  kind: "command";
  name: string;
  path: string;
  relativePath: string;
  description?: string;
  argumentHint?: string;
  reserved: boolean;
  body: string;
}

export interface CodeAgentProjectSkill {
  kind: "skill";
  name: string;
  path: string;
  relativePath: string;
  description?: string;
  scope: SkillScope;
  body: string;
}

export interface CodeAgentCodePack {
  schemaVersion: 1;
  root: string;
  commands: CodeAgentProjectCommand[];
  skills: CodeAgentProjectSkill[];
}

export interface ReadProjectCodePackOptions {
  includeReservedCommands?: boolean;
}

interface ParsedFrontmatter {
  data: Record<string, string>;
  body: string;
}

const COMMANDS_DIR = path.join(".agents", "commands");
const SKILLS_DIR = path.join(".agents", "skills");
const RESERVED_PROJECT_COMMAND_NAMES = new Set([
  "approve",
  "approve-always",
  "deny",
  "attach",
  "audit",
  "audit-agent-web",
  "agent-web",
  "e",
  "exec",
  "exit",
  "goals",
  "help",
  "list",
  "migrate",
  "migration",
  "ps",
  "quit",
  "resume",
  "run",
  "start",
  "status",
  "stop",
  "task",
  "todo",
  "ui",
]);

export function readProjectCodePack(
  cwd = process.cwd(),
  options: ReadProjectCodePackOptions = {},
): CodeAgentCodePack {
  return {
    schemaVersion: 1,
    root: cwd,
    commands: options.includeReservedCommands
      ? listProjectSlashCommands(cwd)
      : listVisibleProjectSlashCommands(cwd),
    skills: listProjectSkills(cwd),
  };
}

export function listProjectSlashCommands(
  cwd = process.cwd(),
): CodeAgentProjectCommand[] {
  const root = path.join(cwd, COMMANDS_DIR);
  if (!fs.existsSync(root)) return [];
  return walkMarkdownFiles(root)
    .map((filePath) => readProjectSlashCommand(root, filePath))
    .filter((command): command is CodeAgentProjectCommand => Boolean(command))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listVisibleProjectSlashCommands(
  cwd = process.cwd(),
): CodeAgentProjectCommand[] {
  return listProjectSlashCommands(cwd).filter((command) => !command.reserved);
}

export function findProjectSlashCommand(
  commandName: string,
  cwd = process.cwd(),
): CodeAgentProjectCommand | null {
  const normalized = normalizeProjectSlashCommandName(commandName);
  return (
    listProjectSlashCommands(cwd).find(
      (command) => command.name === normalized,
    ) ?? null
  );
}

export function listProjectSkills(
  cwd = process.cwd(),
): CodeAgentProjectSkill[] {
  const root = path.join(cwd, SKILLS_DIR);
  if (!fs.existsSync(root)) return [];
  return walkMarkdownFiles(root)
    .map((filePath) => readProjectSkill(root, filePath))
    .filter((skill): skill is CodeAgentProjectSkill => Boolean(skill))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isReservedProjectSlashCommandName(value: string): boolean {
  return RESERVED_PROJECT_COMMAND_NAMES.has(
    normalizeProjectSlashCommandName(value),
  );
}

export function renderProjectSlashCommandPrompt(
  command: CodeAgentProjectCommand,
  args: string[],
): string {
  const argumentText = args.join(" ").trim();
  const positional = args
    .map((arg, index) => [`$${index + 1}`, arg] as const)
    .reduce(
      (body, [token, value]) => body.replaceAll(token, value),
      command.body,
    );
  const withArguments = positional.replaceAll("$ARGUMENTS", argumentText);
  return [
    `Run project slash command /${command.name}.`,
    command.description ? `Description: ${command.description}` : "",
    argumentText ? `Arguments: ${argumentText}` : "",
    "",
    withArguments.trim(),
  ]
    .filter((part) => part.length > 0)
    .join("\n");
}

export function normalizeProjectSlashCommandName(value: string): string {
  return value
    .replace(/^\//, "")
    .replaceAll("\\", "/")
    .replaceAll("/", ":")
    .toLowerCase();
}

function walkMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files;
}

function readProjectSlashCommand(
  root: string,
  filePath: string,
): CodeAgentProjectCommand | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(raw);
    const relative = path.relative(root, filePath).replace(/\.md$/i, "");
    if (relative.toLowerCase() === "readme") return null;
    const name = normalizeProjectSlashCommandName(relative);
    if (!name) return null;
    return {
      kind: "command",
      name,
      path: filePath,
      relativePath: path.relative(root, filePath),
      description: parsed.data.description,
      argumentHint: parsed.data["argument-hint"],
      reserved: isReservedProjectSlashCommandName(name),
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

function readProjectSkill(
  root: string,
  filePath: string,
): CodeAgentProjectSkill | null {
  try {
    if (path.basename(filePath).toLowerCase() !== "skill.md") return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(raw);
    const relative = path.relative(root, filePath);
    const skillDir = path.dirname(relative);
    const fallbackName = skillDir === "." ? path.basename(root) : skillDir;
    const name = parsed.data.name || normalizeSkillName(fallbackName);
    if (!name) return null;
    const scope = normalizeSkillScope(parsed.data.scope);
    if (scope === "runtime") return null;
    return {
      kind: "skill",
      name,
      path: filePath,
      relativePath: relative,
      description: parsed.data.description,
      scope,
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const frontmatter = match[1].trim();
  const body = match[2];
  const data: Record<string, string> = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (value === ">-" || value === ">" || value === "|" || value === "|-") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].trim());
      }
      data[key] = value.startsWith("|")
        ? block.join("\n").trim()
        : block.join(" ").trim();
      continue;
    }
    data[key] = value.replace(/^["']|["']$/g, "").trim();
  }
  return { data, body };
}

function normalizeSkillName(value: string): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).join(":");
}
