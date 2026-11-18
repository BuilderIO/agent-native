import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findStrictTestIssues } from "./guard-strict-test-lint.ts";
import { GUARD_EXIT_COULD_NOT_RUN } from "./lib/changed-lines.mjs";
import {
  isGeneratedSource,
  isHandwrittenSource,
  isTestSource,
  requireSourceChanges,
} from "./lib/guard-source.ts";
import {
  pnpmCommand,
  type PnpmCommand,
  WINDOWS_COMMAND_LINE_LIMIT,
  windowsCommandLine,
} from "./lib/pnpm-command.ts";

const GUARD_NAME = "guard:strict-lint";
const rootDir = path.resolve(import.meta.dirname, "..");

export const STRICT_RULES = [
  "typescript/no-floating-promises",
  "typescript/no-misused-promises",
  "typescript/switch-exhaustiveness-check",
  "typescript/no-explicit-any",
  "typescript/no-non-null-assertion",
  "typescript/only-throw-error",
  "typescript/no-unnecessary-condition",
] as const;

export const STRICT_TEST_RULES = [
  "vitest/valid-expect",
  "vitest/no-conditional-expect",
  "vitest/no-identical-title",
] as const;

const SOURCE_FILE = /\.[cm]?tsx?$/;
const BATCH_SIZE = 400;

export interface StrictLintFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
}

export type FilterResult =
  | { ok: true; findings: StrictLintFinding[] }
  | { ok: false; reason: string };

interface OxlintDiagnostic {
  message?: string;
  code?: string | null;
  filename?: string;
  labels?: { span?: { line?: number } }[];
}

/** `typescript(no-explicit-any)` -> `typescript/no-explicit-any` */
function ruleName(code: string): string {
  const match = /^([^()]+)\((.+)\)$/.exec(code);
  return match ? `${match[1]}/${match[2]}` : code;
}

/**
 * Keep the strict-rule diagnostics that start on a line this branch added.
 * `added` is keyed by absolute path, as changed-lines.mjs returns it.
 */
export function filterStrictDiagnostics(
  stdout: string,
  added: Map<string, Set<number>>,
  cwd: string,
  expectedFiles: number,
): FilterResult {
  let parsed: { diagnostics?: OxlintDiagnostic[]; number_of_files?: number };
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    return {
      ok: false,
      reason: `oxlint output was not JSON (${(error as Error).message})`,
    };
  }
  if (!parsed || !Array.isArray(parsed.diagnostics)) {
    return { ok: false, reason: "oxlint JSON had no diagnostics array" };
  }
  if (parsed.number_of_files !== expectedFiles) {
    return {
      ok: false,
      reason: `oxlint inspected ${parsed.number_of_files ?? "an unknown number of"} files; expected ${expectedFiles}`,
    };
  }

  const findings: StrictLintFinding[] = [];
  const strict = new Set<string>([...STRICT_RULES, ...STRICT_TEST_RULES]);
  for (const diagnostic of parsed.diagnostics) {
    // A diagnostic with no rule is a syntax error: the file was not linted.
    if (!diagnostic.code) {
      return {
        ok: false,
        reason: `oxlint could not lint ${diagnostic.filename ?? "a file"}: ${diagnostic.message ?? "unknown error"}`,
      };
    }
    const rule = ruleName(diagnostic.code);
    if (!strict.has(rule)) continue;
    const line = diagnostic.labels?.[0]?.span?.line;
    if (!diagnostic.filename || typeof line !== "number") {
      return {
        ok: false,
        reason: `${rule} diagnostic has no file/line: ${JSON.stringify(diagnostic).slice(0, 200)}`,
      };
    }
    const file = path.resolve(cwd, diagnostic.filename);
    if (!added.get(file)?.has(line)) continue;
    findings.push({
      file: path.relative(cwd, file),
      line,
      rule,
      message: diagnostic.message ?? "",
    });
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { ok: true, findings };
}

export function oxlintArgs(files: string[], tests = false): string[] {
  return [
    "exec",
    "oxlint",
    "--config",
    tests
      ? "scripts/guard-strict-tests.oxlint.json"
      : "scripts/guard-strict-source.oxlint.ts",
    "--type-aware",
    "--format",
    "json",
    "--no-ignore",
    "--disable-nested-config",
    "--no-error-on-unmatched-pattern",
    ...STRICT_RULES.flatMap((rule) => ["-D", rule]),
    ...(tests ? STRICT_TEST_RULES.flatMap((rule) => ["-D", rule]) : []),
    ...files,
  ];
}

/**
 * Splits files into oxlint runs of at most BATCH_SIZE. On Windows pnpm can run
 * through cmd.exe, so a run there also ends before its command line passes
 * WINDOWS_COMMAND_LINE_LIMIT, the length that fits cmd.exe's limit.
 */
export function lintBatches(
  files: string[],
  platform: NodeJS.Platform = process.platform,
  tests = false,
): string[][] {
  const lineLimit =
    platform === "win32"
      ? WINDOWS_COMMAND_LINE_LIMIT
      : Number.POSITIVE_INFINITY;
  const baseLength =
    platform === "win32" ? windowsCommandLine(oxlintArgs([], tests)).length : 0;
  const batches: string[][] = [];
  let batch: string[] = [];
  let length = baseLength;
  for (const file of files) {
    // Each file adds its two quotes and the space before it.
    const added = file.length + 3;
    if (
      batch.length > 0 &&
      (batch.length >= BATCH_SIZE || length + added > lineLimit)
    ) {
      batches.push(batch);
      batch = [];
      length = baseLength;
    }
    batch.push(file);
    length += added;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

function couldNotRun(reason: string): never {
  console.error(`${GUARD_NAME}: could not run - ${reason}`);
  process.exit(GUARD_EXIT_COULD_NOT_RUN);
}

function main() {
  let added: Map<string, Set<number>>;
  try {
    added = requireSourceChanges(rootDir, GUARD_NAME);
  } catch (error) {
    couldNotRun(error instanceof Error ? error.message : String(error));
  }
  const findings: StrictLintFinding[] = [];
  const testFiles: string[] = [];
  const sourceFiles: string[] = [];
  let fileCount = 0;
  for (const [absolute, lines] of added) {
    const file = path.relative(rootDir, absolute);
    if (!isHandwrittenSource(file) || !existsSync(absolute)) continue;
    try {
      const text = readFileSync(absolute, "utf8");
      if (isGeneratedSource(text)) continue;
      if (isTestSource(file)) testFiles.push(file);
      else if (SOURCE_FILE.test(file)) sourceFiles.push(file);
      findings.push(...findStrictTestIssues(file, text, lines));
      fileCount++;
    } catch (error) {
      couldNotRun(error instanceof Error ? error.message : String(error));
    }
  }

  if (fileCount === 0) {
    console.log(`${GUARD_NAME}: no changed TypeScript files, nothing to lint`);
    return;
  }

  const batches = [
    ...lintBatches(sourceFiles).map((batch) => ({ batch, tests: false })),
    ...lintBatches(testFiles, process.platform, true).map((batch) => ({
      batch,
      tests: true,
    })),
  ];
  for (const { batch, tests } of batches) {
    let pnpm: PnpmCommand;
    try {
      pnpm = pnpmCommand(oxlintArgs(batch, tests));
    } catch (error) {
      couldNotRun((error as Error).message);
    }
    const run = spawnSync(pnpm.command, pnpm.args, {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      shell: pnpm.shell,
    });
    if (run.error) couldNotRun(`could not start oxlint: ${run.error.message}`);
    if (run.status !== 0 && run.status !== 1) {
      couldNotRun(
        `oxlint exited ${run.status}: ${(run.stderr || "").trim().slice(0, 1000)}`,
      );
    }
    // Exit 1 just means "errors found"; anything else with no JSON is a crash.
    const result = filterStrictDiagnostics(
      run.stdout,
      added,
      rootDir,
      batch.length,
    );
    if (!result.ok) {
      const detail = (run.stderr || "").trim().slice(0, 1000);
      couldNotRun(
        `${result.reason} (oxlint exit ${run.status})${detail ? `\n${detail}` : ""}`,
      );
    }
    findings.push(...result.findings);
  }

  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${fileCount} changed file(s), no strict-lint findings on added lines)`,
    );
    return;
  }
  console.error(
    `${GUARD_NAME}: ${findings.length} finding(s) on lines this branch added.\n` +
      "Fix them. For Oxlint rules, a one-line exception needs a reason:\n" +
      "  // oxlint-disable-next-line <rule> -- <reason>\n",
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} ${f.rule} ${f.message}`);
  }
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
