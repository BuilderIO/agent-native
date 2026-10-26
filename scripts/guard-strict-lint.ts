/**
 * guard-strict-lint.ts
 *
 * Type-aware lint rules that catch the bug classes behind most of our repeat
 * incidents - a dropped promise (the work never happened, nothing reports it),
 * an async callback handed to a void API (a rejection nobody handles), a
 * `switch` that silently ignores a new union member, `any` and `!` that turn
 * the compiler off, a non-Error `throw` that loses its stack, and a condition
 * the types prove can never vary:
 *
 *   typescript/no-floating-promises        typescript/no-explicit-any
 *   typescript/no-misused-promises         typescript/no-non-null-assertion
 *   typescript/switch-exhaustiveness-check typescript/only-throw-error
 *   typescript/no-unnecessary-condition
 *
 * `.oxlintrc.json` keeps them off so the existing backlog stays quiet; this
 * guard turns them into errors on lines THIS BRANCH ADDS (via
 * scripts/lib/changed-lines.mjs), so the backlog can shrink separately but
 * never grow. Files go through the repo config, so its ignorePatterns and
 * overrides still apply.
 *
 * Fix the code. When a line really is right (a deliberate fire-and-forget, a
 * proven non-null), say why with the normal oxlint comment:
 *
 *   // oxlint-disable-next-line typescript/no-floating-promises -- <reason>
 *
 * A separate escape-hatch ratchet counts those disables, so each one is a
 * reviewed decision rather than a free pass.
 *
 * Exit codes follow CLAUDE.md "Checks": 0 passed, 1 findings, 2 could not run.
 * oxlint failing, unparseable output, a config error, or a file it could not
 * parse (a diagnostic with no rule) is exit 2 - never a pass over code that
 * was not linted.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

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
): FilterResult {
  let parsed: { diagnostics?: OxlintDiagnostic[] };
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

  const findings: StrictLintFinding[] = [];
  const strict = new Set<string>(STRICT_RULES);
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

export function oxlintArgs(files: string[]): string[] {
  return [
    "exec",
    "oxlint",
    "--config",
    ".oxlintrc.json",
    "--type-aware",
    "--format",
    "json",
    "--no-error-on-unmatched-pattern",
    ...STRICT_RULES.flatMap((rule) => ["-D", rule]),
    ...files,
  ];
}

function couldNotRun(reason: string): never {
  console.error(`${GUARD_NAME}: could not run - ${reason}`);
  process.exit(GUARD_EXIT_COULD_NOT_RUN);
}

function main() {
  const added = requireAddedLines(rootDir, GUARD_NAME);
  const files = [...added.keys()]
    .filter((file) => SOURCE_FILE.test(file) && existsSync(file))
    .map((file) => path.relative(rootDir, file));

  if (files.length === 0) {
    console.log(`${GUARD_NAME}: no changed TypeScript files, nothing to lint`);
    return;
  }

  const findings: StrictLintFinding[] = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const run = spawnSync("pnpm", oxlintArgs(batch), {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    if (run.error) couldNotRun(`could not start oxlint: ${run.error.message}`);
    // Exit 1 just means "errors found"; anything else with no JSON is a crash.
    const result = filterStrictDiagnostics(run.stdout, added, rootDir);
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
      `${GUARD_NAME}: OK (${files.length} changed file(s), no strict-lint findings on added lines)`,
    );
    return;
  }
  console.error(
    `${GUARD_NAME}: ${findings.length} finding(s) on lines this branch added.\n` +
      "Fix them, or disable one line with a reason:\n" +
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
