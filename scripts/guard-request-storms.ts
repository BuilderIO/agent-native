import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALLOW_MARKER = /request-storm-allow:\s*(\S.{10,})/;
const SHARED_SYNC_EVENT_SOURCE = "packages/core/src/client/use-db-sync.ts";
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "__tests__",
  "build",
  "corpus",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

export type RequestStormRule =
  | "background-refetch"
  | "fast-fixed-poll"
  | "focus-refetch"
  | "app-event-source";

export type RequestStormViolation = {
  file: string;
  line: number;
  rule: RequestStormRule;
  message: string;
};

type AnalyzeOptions = {
  file: string;
  source: string;
};

function hasAdjacentAllow(source: string, line: number): boolean {
  const lines = source.split(/\r?\n/);
  const currentIndex = line - 1;
  for (
    let index = currentIndex;
    index >= Math.max(0, currentIndex - 2);
    index -= 1
  ) {
    const text = lines[index] ?? "";
    if (ALLOW_MARKER.test(text)) return true;
    if (index < currentIndex && text.trim() && !/^\s*(?:\/\/|\*)/.test(text)) {
      break;
    }
  }
  return false;
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

/** Mask comments and string literals while preserving offsets and newlines. */
function maskNonCode(source: string): string {
  const output = source.split("");
  let state: "code" | "line" | "block" | "single" | "double" | "template" =
    "code";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state === "code") {
      if (char === "/" && next === "/") {
        output[index] = output[index + 1] = " ";
        state = "line";
        index += 1;
      } else if (char === "/" && next === "*") {
        output[index] = output[index + 1] = " ";
        state = "block";
        index += 1;
      } else if (char === "'") {
        output[index] = " ";
        state = "single";
      } else if (char === '"') {
        output[index] = " ";
        state = "double";
      } else if (char === "`") {
        output[index] = " ";
        state = "template";
      }
      continue;
    }

    if (char !== "\n" && char !== "\r") output[index] = " ";
    if (state === "line") {
      if (char === "\n") state = "code";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        output[index + 1] = " ";
        state = "code";
        index += 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (
      (state === "single" && char === "'") ||
      (state === "double" && char === '"') ||
      (state === "template" && char === "`")
    ) {
      state = "code";
    }
  }
  return output.join("");
}

function violation(
  file: string,
  source: string,
  index: number,
  rule: RequestStormRule,
  message: string,
): RequestStormViolation {
  return { file, line: lineAt(source, index), rule, message };
}

export function analyzeRequestStormSource({
  file,
  source,
}: AnalyzeOptions): RequestStormViolation[] {
  const violations: RequestStormViolation[] = [];
  const code = maskNonCode(source);
  const rules: Array<{
    pattern: RegExp;
    rule: RequestStormRule;
    message: string;
    skip?: boolean;
    matches?: (match: RegExpMatchArray) => boolean;
  }> = [
    {
      pattern: /\brefetchIntervalInBackground\s*:\s*true\b/g,
      rule: "background-refetch",
      message:
        "background refetching can create paid requests while nobody is using the app",
    },
    {
      pattern:
        /\brefetchInterval\s*:\s*(\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)\b/g,
      rule: "fast-fixed-poll",
      message:
        "fixed refetch intervals at or below five seconds create a steady paid-request floor",
      matches: (match) => {
        const interval = Number((match[1] ?? "").replaceAll("_", ""));
        return Number.isFinite(interval) && interval <= 5_000;
      },
    },
    {
      pattern: /\brefetchOnWindowFocus\s*:\s*true\b/g,
      rule: "focus-refetch",
      message:
        "focus refetching must be bounded and justified because one focus can fan out across mounted queries",
    },
    {
      pattern: /\bnew\s+EventSource\s*\(/g,
      rule: "app-event-source",
      message:
        "app-owned EventSource connections must use the core shared sync transport unless a bounded protocol exception is documented",
      skip: file === SHARED_SYNC_EVENT_SOURCE,
    },
  ];

  for (const rule of rules) {
    if (rule.skip) continue;
    for (const match of code.matchAll(rule.pattern)) {
      if (rule.matches && !rule.matches(match)) continue;
      const item = violation(
        file,
        source,
        match.index,
        rule.rule,
        rule.message,
      );
      if (!hasAdjacentAllow(source, item.line)) violations.push(item);
    }
  }
  return violations;
}

export function shouldScanRequestStormFile(relativeFile: string): boolean {
  const normalized = relativeFile.split(path.sep).join("/");
  if (!/^(?:templates|packages)\//.test(normalized)) return false;
  if (!/\.(?:ts|tsx)$/.test(normalized)) return false;
  if (/\.(?:spec|test)\.(?:ts|tsx)$/.test(normalized)) return false;
  if (/\.(?:generated|gen)\.(?:ts|tsx)$/.test(normalized)) return false;
  return !normalized
    .split("/")
    .some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment));
}

function discoverFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const visit = (absolutePath: string): void => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(absolutePath, entry.name);
      const relative = path.relative(repoRoot, child);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) continue;
        visit(child);
      } else if (shouldScanRequestStormFile(relative)) {
        files.push(relative.split(path.sep).join("/"));
      }
    }
  };

  for (const root of ["templates", "packages"]) {
    const absoluteRoot = path.join(repoRoot, root);
    if (existsSync(absoluteRoot)) visit(absoluteRoot);
  }
  return files.sort();
}

export function checkRequestStorms(repoRoot: string): {
  filesChecked: number;
  violations: RequestStormViolation[];
} {
  const files = discoverFiles(repoRoot);
  return {
    filesChecked: files.length,
    violations: files.flatMap((file) =>
      analyzeRequestStormSource({
        file,
        source: readFileSync(path.join(repoRoot, file), "utf8"),
      }),
    ),
  };
}

function main(): void {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const result = checkRequestStorms(repoRoot);
  if (result.violations.length > 0) {
    console.error(
      `[guard:request-storms] ${result.violations.length} issue(s):\n${result.violations
        .map(
          (item) =>
            `- ${item.file}:${item.line} [${item.rule}] ${item.message}. Add an adjacent \`request-storm-allow: <precise rationale>\` comment only for a genuinely bounded exception.`,
        )
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[guard:request-storms] clean (${result.filesChecked} maintained TypeScript files)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
