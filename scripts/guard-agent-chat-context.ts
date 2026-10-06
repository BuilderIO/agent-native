import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_DECLARED_STARTER_TOOLS = 40;

export const MAX_AGENT_INSTRUCTION_CHARS = 6_000;

export const WARN_AGENT_INSTRUCTION_CHARS = 5_500;

export type AgentChatContextPolicy = {
  file: string;
  leanPrompt: boolean;
  starterToolCount: number | null;
  starterToolNames: string[] | null;
  errors: string[];
};

type AnalyzeOptions = {
  file: string;
  source: string;
  readSource?: (file: string) => string;
};

function findArrayBody(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(
      `(?:export\\s+)?const\\s+${escaped}(?:\\s*:[^=]+)?\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as\\s+const\\s*)?;`,
    ),
  );
  return match?.[1] ?? null;
}

function importedSourceFile(
  source: string,
  identifier: string,
  importingFile: string,
): string | null {
  const importPattern = /import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const importedNames = (match[1] ?? "")
      .split(",")
      .map((entry) =>
        entry
          .trim()
          .split(/\s+as\s+/)
          .pop(),
      )
      .filter(Boolean);
    if (!importedNames.includes(identifier)) continue;
    const specifier = match[2];
    if (!specifier?.startsWith(".")) return null;
    const unresolved = path.resolve(path.dirname(importingFile), specifier);
    const candidates = [
      unresolved,
      unresolved.replace(/\.js$/, ".ts"),
      `${unresolved}.ts`,
      path.join(unresolved, "index.ts"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }
  return null;
}

function parseStaticStringEntries(arrayBody: string): string[] | null {
  if (/\.\.\./.test(arrayBody)) return null;
  const withoutComments = arrayBody
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const stringEntries = [...withoutComments.matchAll(/["']([^"']+)["']/g)];
  const remainder = withoutComments
    .replace(/["'][^"']+["']/g, "")
    .replace(/[\s,]/g, "");
  if (remainder) return null;
  return stringEntries.map((entry) => entry[1] ?? "");
}

function countStarterTools(arrayBody: string): number | null {
  return parseStaticStringEntries(arrayBody)?.length ?? null;
}

export function analyzeAgentChatContextPolicy(
  options: AnalyzeOptions,
): AgentChatContextPolicy | null {
  const { file, source } = options;
  if (!/\bcreateAgentChatPlugin\s*\(/.test(source)) return null;

  const leanPrompt = /\bleanPrompt\s*:\s*true\b/.test(source);
  const initialProperty = source.match(
    /\binitialToolNames\s*:\s*(\[[\s\S]*?\]|[A-Za-z_$][\w$]*)\s*[,}]/,
  );
  const errors: string[] = [];
  let starterToolCount: number | null = null;
  let starterToolNames: string[] | null = null;

  if (!initialProperty && !leanPrompt) {
    errors.push(
      `${file}: createAgentChatPlugin must declare initialToolNames or leanPrompt: true so the first LLM request does not receive the full tool catalog.`,
    );
  }

  if (initialProperty) {
    const value = initialProperty[1] ?? "";
    let arrayBody: string | null = null;
    if (value.startsWith("[")) {
      arrayBody = value.slice(1, -1);
    } else {
      arrayBody = findArrayBody(source, value);
      if (arrayBody === null) {
        const importedFile = importedSourceFile(source, value, file);
        if (importedFile) {
          const importedSource =
            options.readSource?.(importedFile) ??
            readFileSync(importedFile, "utf8");
          arrayBody = findArrayBody(importedSource, value);
        }
      }
    }

    starterToolNames =
      arrayBody === null ? null : parseStaticStringEntries(arrayBody);
    starterToolCount = starterToolNames?.length ?? null;
    if (starterToolCount === null) {
      errors.push(
        `${file}: initialToolNames must resolve to a static array of string literals so its first-request cost stays auditable.`,
      );
    } else if (starterToolCount > MAX_DECLARED_STARTER_TOOLS) {
      errors.push(
        `${file}: initialToolNames declares ${starterToolCount} tools; the first-request ceiling is ${MAX_DECLARED_STARTER_TOOLS}. Move uncommon schemas behind tool-search.`,
      );
    }
  }

  return { file, leanPrompt, starterToolCount, starterToolNames, errors };
}

const FRAMEWORK_STARTER_TOOL_NAMES = new Set([
  "call-agent",
  "create-extension",
  "describe-workspace-apps",
  "extension-data-set",
  "get-extension",
  "list-extensions",
  "show-workspace-file",
  "update-extension",
]);

const ACTION_DISCOVERY_SKIP_FILES = new Set([
  "helpers",
  "run",
  "db-connect",
  "db-status",
  "registry",
]);

function frameworkActionNames(repoRoot: string): Set<string> {
  const names = new Set(FRAMEWORK_STARTER_TOOL_NAMES);
  const source = readFileSync(
    path.join(repoRoot, "packages/core/src/framework-tools.ts"),
    "utf8",
  );
  for (const match of source.matchAll(/^\s*"([^"\n]+)":\s*"[^"\n]+",?$/gm)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

function collectActionNames(dir: string, names: Set<string>): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (
      !/\.(?:ts|tsx)$/.test(entry.name) ||
      /\.(?:spec|test)\.(?:ts|tsx)$/.test(entry.name)
    ) {
      continue;
    }
    if (entry.name.startsWith("_")) continue;
    const name = entry.name.replace(/\.(?:ts|tsx)$/, "");
    if (ACTION_DISCOVERY_SKIP_FILES.has(name)) continue;
    const source = readFileSync(path.join(dir, entry.name), "utf8");
    const isActionSource =
      source.includes("defineAction") ||
      /export\s*\{\s*default\s*\}\s*from\s*["'][^"']+["']/.test(source) ||
      /export\s+default\s+(?:create[A-Z][A-Za-z0-9]*Action|defineActionFactory)\s*\(/.test(
        source,
      );
    if (!isActionSource) {
      continue;
    }
    names.add(name);
  }
}

function actionDirectoriesForPlugin(
  repoRoot: string,
  pluginFile: string,
): string[] {
  const relative = path.relative(repoRoot, pluginFile).split(path.sep);
  const directories: string[] = [];
  if (relative[0] === "templates" && relative[2] === "server") {
    directories.push(path.join(repoRoot, "templates", relative[1]!, "actions"));
  }
  if (
    relative[0] === "packages" &&
    relative[2] === "src" &&
    relative[3] === "server"
  ) {
    directories.push(
      path.join(repoRoot, "packages", relative[1]!, "src", "actions"),
    );
  }
  const source = readFileSync(pluginFile, "utf8");
  if (/@agent-native\/dispatch(?:\/|["'])/.test(source)) {
    directories.push(
      path.join(repoRoot, "packages", "dispatch", "src", "actions"),
    );
  }
  return [...new Set(directories)];
}

function discoverActionNames(
  repoRoot: string,
  pluginFile: string,
): Set<string> {
  const names = frameworkActionNames(repoRoot);
  for (const actionDir of actionDirectoriesForPlugin(repoRoot, pluginFile)) {
    collectActionNames(actionDir, names);
  }
  return names;
}

export function discoverAgentChatPlugins(repoRoot: string): string[] {
  const files: string[] = [];
  for (const [parent, nested] of [
    ["templates", ["server", "plugins", "agent-chat.ts"]],
    ["packages", ["src", "server", "plugins", "agent-chat.ts"]],
  ] as const) {
    const parentDir = path.join(repoRoot, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(parentDir, entry.name, ...nested);
      if (existsSync(candidate)) files.push(candidate);
    }
  }
  return files.sort();
}

export function discoverAgentInstructionFiles(repoRoot: string): string[] {
  const files: string[] = [];
  for (const parent of ["templates", "apps"]) {
    const parentDir = path.join(repoRoot, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(parentDir, entry.name, "AGENTS.md");
      if (existsSync(candidate)) files.push(candidate);
    }
  }
  for (const template of ["default", "headless", "workspace-core"]) {
    const candidate = path.join(
      repoRoot,
      "packages/core/src/templates",
      template,
      "AGENTS.md",
    );
    if (existsSync(candidate)) files.push(candidate);
  }
  return files.sort();
}

export function checkAgentInstructionSizes(repoRoot: string): {
  sizes: Array<{
    file: string;
    chars: number;
    overCap: boolean;
    nearCap: boolean;
  }>;
  errors: string[];
  warnings: string[];
} {
  const sizes: Array<{
    file: string;
    chars: number;
    overCap: boolean;
    nearCap: boolean;
  }> = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const file of discoverAgentInstructionFiles(repoRoot)) {
    const chars = readFileSync(file, "utf8").trim().length;
    const relative = path.relative(repoRoot, file);
    const overCap = chars > MAX_AGENT_INSTRUCTION_CHARS;
    const nearCap = !overCap && chars > WARN_AGENT_INSTRUCTION_CHARS;
    sizes.push({ file: relative, chars, overCap, nearCap });

    if (overCap) {
      const dropped = chars - MAX_AGENT_INSTRUCTION_CHARS;
      errors.push(
        `${relative}: ${chars} characters exceeds the ${MAX_AGENT_INSTRUCTION_CHARS}-character compact-prompt cap; the last ${dropped} characters are silently dropped before the model sees them. Move detail into .agents/skills/* and point at it from the skills list.`,
      );
    } else if (nearCap) {
      const headroom = MAX_AGENT_INSTRUCTION_CHARS - chars;
      warnings.push(
        `${relative}: ${chars} characters is over the ${WARN_AGENT_INSTRUCTION_CHARS}-character soft limit — only ${headroom} characters of headroom before the ${MAX_AGENT_INSTRUCTION_CHARS}-character hard cap starts dropping content. Move detail into .agents/skills/* now.`,
      );
    }
  }
  return { sizes, errors, warnings };
}

export function checkAgentChatContextPolicies(repoRoot: string): {
  policies: AgentChatContextPolicy[];
  errors: string[];
} {
  const policiesWithFiles = discoverAgentChatPlugins(repoRoot)
    .map((file) => ({
      file,
      policy: analyzeAgentChatContextPolicy({
        file: path.relative(repoRoot, file),
        source: readFileSync(file, "utf8"),
        readSource: (importedFile) => readFileSync(importedFile, "utf8"),
      }),
    }))
    .filter(
      (entry): entry is { file: string; policy: AgentChatContextPolicy } =>
        entry.policy !== null,
    );
  const policies = policiesWithFiles.map(({ policy }) => policy);
  const errors = policiesWithFiles.flatMap(({ file, policy }) => {
    const knownActionNames = discoverActionNames(repoRoot, file);
    const missing = (policy.starterToolNames ?? []).filter(
      (name) => !knownActionNames.has(name),
    );
    return [
      ...policy.errors,
      ...missing.map(
        (name) =>
          `${path.relative(repoRoot, file)}: starter tool "${name}" has no matching action source under this app's actions/ directory or the framework catalog; remove it or restore the action before shipping.`,
      ),
    ];
  });
  return { policies, errors };
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const result = checkAgentChatContextPolicies(repoRoot);
  const instructions = checkAgentInstructionSizes(repoRoot);
  for (const entry of instructions.sizes) {
    const status = entry.overCap
      ? " (OVER CAP)"
      : entry.nearCap
        ? " (WARN: approaching cap)"
        : "";
    console.log(
      `[guard:agent-chat-context] ${entry.file}: ${entry.chars}/${MAX_AGENT_INSTRUCTION_CHARS} instruction chars${status}`,
    );
  }
  result.errors.push(...instructions.errors);
  if (instructions.warnings.length > 0) {
    console.warn(
      `[guard:agent-chat-context] WARNING: ${instructions.warnings.length} file(s) over the ${WARN_AGENT_INSTRUCTION_CHARS}-character soft limit (does not fail the build):\n${instructions.warnings.map((warning) => `- ${warning}`).join("\n")}`,
    );
  }
  for (const policy of result.policies) {
    const count =
      policy.starterToolCount === null
        ? policy.leanPrompt
          ? "lean prompt"
          : "unresolved"
        : `${policy.starterToolCount} starter tools`;
    console.log(`[guard:agent-chat-context] ${policy.file}: ${count}`);
  }
  if (result.errors.length > 0) {
    console.error(
      `[guard:agent-chat-context] ${result.errors.length} issue(s):\n${result.errors.map((error) => `- ${error}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[guard:agent-chat-context] clean (${result.policies.length} first-party agent chat plugins)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
