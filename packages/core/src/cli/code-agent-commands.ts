import fs from "fs";
import path from "path";

export interface CodeAgentProjectCommand {
  name: string;
  path: string;
  description?: string;
  argumentHint?: string;
  body: string;
}

interface ParsedFrontmatter {
  data: Record<string, string>;
  body: string;
}

const COMMANDS_DIR = path.join(".agents", "commands");

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
      name,
      path: filePath,
      description: parsed.data.description,
      argumentHint: parsed.data["argument-hint"],
      body: parsed.body,
    };
  } catch {
    return null;
  }
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith("---\n")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: raw };
  const frontmatter = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    data[key] = value.replace(/^["']|["']$/g, "").trim();
  }
  return { data, body };
}
