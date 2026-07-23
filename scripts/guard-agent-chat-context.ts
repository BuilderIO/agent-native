import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_DECLARED_STARTER_TOOLS = 40;

export type AgentChatContextPolicy = {
  file: string;
  leanPrompt: boolean;
  starterToolCount: number | null;
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

function countStarterTools(arrayBody: string): number | null {
  // Starter catalogs must stay statically auditable. Spreads or expressions
  // can hide an arbitrarily large catalog, so require plain string entries.
  if (/\.\.\./.test(arrayBody)) return null;
  const withoutComments = arrayBody
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const stringEntries = [...withoutComments.matchAll(/["']([^"']+)["']/g)];
  const remainder = withoutComments
    .replace(/["'][^"']+["']/g, "")
    .replace(/[\s,]/g, "");
  if (remainder) return null;
  return stringEntries.length;
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

    starterToolCount = arrayBody === null ? null : countStarterTools(arrayBody);
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

  return { file, leanPrompt, starterToolCount, errors };
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

export function checkAgentChatContextPolicies(repoRoot: string): {
  policies: AgentChatContextPolicy[];
  errors: string[];
} {
  const policies = discoverAgentChatPlugins(repoRoot)
    .map((file) =>
      analyzeAgentChatContextPolicy({
        file: path.relative(repoRoot, file),
        source: readFileSync(file, "utf8"),
        readSource: (importedFile) => readFileSync(importedFile, "utf8"),
      }),
    )
    .filter((policy): policy is AgentChatContextPolicy => policy !== null);
  return { policies, errors: policies.flatMap((policy) => policy.errors) };
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const result = checkAgentChatContextPolicies(repoRoot);
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
