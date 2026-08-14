import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_PATH_PREFIXES = [
  "docs/",
  "packages/core/docs/",
  "packages/docs/",
] as const;

const DOCS_ROOT_FILES = new Set(["CONTRIBUTING.md", "README.md"]);

const DOCS_SUPPORT_PATHS = new Set([
  "scripts/i18n-catalog-english-value-baseline.txt",
  "scripts/i18n-localized-docs-baseline.txt",
  "scripts/i18n-no-translate-terms.txt",
  "scripts/i18n-raw-literal-baseline.txt",
]);

export function normalizeChangedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function isDocsPath(path: string): boolean {
  const normalized = normalizeChangedPath(path);
  return (
    DOCS_ROOT_FILES.has(normalized) ||
    normalized.startsWith(".changeset/") ||
    DOCS_SUPPORT_PATHS.has(normalized) ||
    DOCS_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function classifyChangedPaths(paths: readonly string[]) {
  const changedPaths = paths.map(normalizeChangedPath);
  const nonDocsPaths = changedPaths.filter((path) => !isDocsPath(path));

  return {
    changedPaths,
    docsOnly: changedPaths.length > 0 && nonDocsPaths.length === 0,
    nonDocsPaths,
  };
}

export function readChangedPaths(baseSha: string, headSha: string): string[] {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "-z", `${baseSha}...${headSha}`],
    { encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

function writeOutputs(docsOnly: boolean, changedCount: number): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    appendFileSync(
      outputPath,
      `docs_only=${docsOnly ? "true" : "false"}\nchanged_count=${changedCount}\n`,
    );
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(
      summaryPath,
      [
        "## CI change scope",
        "",
        `- Docs-only change: **${docsOnly ? "yes" : "no"}**`,
        `- Changed paths: **${changedCount}**`,
        "",
      ].join("\n"),
    );
  }
}

function main(): void {
  const baseSha = process.env.CI_BASE_SHA;
  const headSha = process.env.CI_HEAD_SHA;
  if (!baseSha || !headSha) {
    throw new Error("CI_BASE_SHA and CI_HEAD_SHA are required");
  }

  const result = classifyChangedPaths(readChangedPaths(baseSha, headSha));
  console.log(JSON.stringify(result, null, 2));
  writeOutputs(result.docsOnly, result.changedPaths.length);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
