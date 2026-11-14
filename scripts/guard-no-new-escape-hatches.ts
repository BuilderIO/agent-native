/**
 * guard-no-new-escape-hatches.ts
 *
 * Agents under pressure to make a type error go away reach for `as any`, a
 * trailing `!`, `@ts-ignore`, or a lint-disable comment. Each one turns a
 * compile-time error into a runtime bug that nothing reports until a user hits
 * it, and each one makes the next edit to that code harder to check.
 *
 * This guard is a per-file ratchet. For every TypeScript file this branch
 * changed, it counts each escape-hatch kind in the working-tree file and in the
 * same file at the merge-base, and fails when any kind grew:
 *
 *   as-any           `x as any`, `<any>x`
 *   any-type         every other `any` type node (`: any`, `Record<string, any>`, `any[]`)
 *   non-null         `x!`
 *   ts-expect-error  `@ts-expect-error` comment directive
 *   ts-ignore        `@ts-ignore` comment directive
 *   lint-disable     `oxlint-disable*` / `eslint-disable*` comment directive
 *
 * Comparing a file with its own merge-base version means there is no baseline
 * file to edit, loosen, or merge-conflict on: existing debt stays where it is
 * and only growth fails. The kinds are independent, so a file that adds an
 * `as any` fails even if it removes three `!` in the same change. A renamed
 * file is compared with its old path; a new file starts from zero.
 *
 * Counting walks the TypeScript AST, so a string that contains "as any" or an
 * `a !== b` never matches, and comment directives are read from real comments
 * only. Test code (`*.spec.*`, `*.test.*`, `*.test-d.ts`, `__tests__/`, `/e2e/`),
 * `.d.ts`, generated and build output, and `prototypes/` are out of scope: the
 * ratchet covers shipped code, and `@ts-expect-error` is the normal way to write
 * a negative type test.
 *
 * There is no opt-out pragma. A pragma would itself be an escape hatch; the
 * only way through is to write the type.
 *
 * Outcomes, per the guard contract in AGENTS.md:
 * - the base ref or merge-base cannot be resolved, or any git call or file read
 *   fails: exit 2 (could not run), never a zero count;
 * - a kind grew in some file: exit 1;
 * - otherwise exit 0.
 *
 * `--report` prints repo-wide totals per kind and the top 10 files, so the PR
 * that introduces the guard can quote its baseline. It always exits 0.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  resolveDiffBase,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-new-escape-hatches";

export const KINDS = [
  "as-any",
  "any-type",
  "non-null",
  "ts-expect-error",
  "ts-ignore",
  "lint-disable",
] as const;

export type Kind = (typeof KINDS)[number];
export type HatchCounts = Record<Kind, number>;

const SOURCE_FILE = /\.[cm]?tsx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const SKIPPED_DIR =
  /(?:^|\/)(?:node_modules|dist|build|\.output|\.generated|prototypes|__tests__|e2e)\//;
const TEST_FILE = /\.(?:spec|test)\.[cm]?tsx?$|\.test-d\.ts$/;

export function isInScope(relPath: string): boolean {
  return (
    SOURCE_FILE.test(relPath) &&
    !DECLARATION_FILE.test(relPath) &&
    !TEST_FILE.test(relPath) &&
    !SKIPPED_DIR.test(relPath)
  );
}

const emptyCounts = (): HatchCounts => ({
  "as-any": 0,
  "any-type": 0,
  "non-null": 0,
  "ts-expect-error": 0,
  "ts-ignore": 0,
  "lint-disable": 0,
});

const total = (counts: HatchCounts) =>
  KINDS.reduce((sum, kind) => sum + counts[kind], 0);

// A directive only counts at the start of a comment line, so prose that merely
// mentions "@ts-ignore" does not.
const COMMENT_DIRECTIVES: Array<[Kind, RegExp]> = [
  ["ts-expect-error", /^\s*\*?\s*@ts-expect-error\b/m],
  ["ts-ignore", /^\s*\*?\s*@ts-ignore\b/m],
  ["lint-disable", /^\s*\*?\s*(?:oxlint|eslint)-disable/m],
];

export function countEscapeHatches(
  text: string,
  fileName = "file.ts",
): HatchCounts {
  const counts = emptyCounts();
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
  );
  const seenComments = new Set<number>();

  const countComments = (pos: number) => {
    // Same-line comments after the previous token are "trailing", not leading.
    const ranges = [
      ...(ts.getTrailingCommentRanges(text, pos) ?? []),
      ...(ts.getLeadingCommentRanges(text, pos) ?? []),
    ];
    for (const range of ranges) {
      if (seenComments.has(range.pos)) continue;
      seenComments.add(range.pos);
      // The delimiters stay in the text; the line-anchored patterns skip them.
      const body = text
        .slice(range.pos, range.end)
        .replace(/^\/\/|^\/\*+|\*+\/$/g, "");
      for (const [kind, pattern] of COMMENT_DIRECTIVES) {
        if (pattern.test(body)) counts[kind] += 1;
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      node.type.kind === ts.SyntaxKind.AnyKeyword
    ) {
      counts["as-any"] += 1;
      // The `any` below is already counted as the assertion.
      visit(node.expression);
      return;
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) counts["any-type"] += 1;
    if (ts.isNonNullExpression(node)) counts["non-null"] += 1;

    const children = node.getChildren(source);
    // JsxText is raw text, not trivia: "// x" inside it is not a comment.
    if (children.length === 0 && node.kind !== ts.SyntaxKind.JsxText) {
      countComments(node.pos);
    }
    for (const child of children) visit(child);
  };
  visit(source);
  return counts;
}

export interface Growth {
  kind: Kind;
  before: number;
  after: number;
}

export function growth(base: HatchCounts, head: HatchCounts): Growth[] {
  return KINDS.filter((kind) => head[kind] > base[kind]).map((kind) => ({
    kind,
    before: base[kind],
    after: head[kind],
  }));
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    // coercion-ok: unavailable Git probes become exit 2 in their callers.
    return null;
  }
}

export interface GuardOutcome {
  code: 0 | 1 | typeof GUARD_EXIT_COULD_NOT_RUN;
  message: string;
}

interface ChangedFile {
  path: string;
  /** Path at the merge-base; null for a file the branch added. */
  basePath: string | null;
}

/** Parses `git diff --name-status -z`: `M\0path\0` or `R100\0old\0new\0`. */
function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length - 1; ) {
    const status = fields[i];
    if (status.startsWith("R") || status.startsWith("C")) {
      files.push({ path: fields[i + 2], basePath: fields[i + 1] });
      i += 3;
    } else {
      files.push({
        path: fields[i + 1],
        basePath: status === "A" ? null : fields[i + 1],
      });
      i += 2;
    }
  }
  return files;
}

export function runEscapeHatchGuard(cwd: string): GuardOutcome {
  const couldNotRun = (reason: string, fix = ""): GuardOutcome => ({
    code: GUARD_EXIT_COULD_NOT_RUN,
    message: `${GUARD_NAME}: ${reason}, so the check did not run.${fix}`,
  });

  const base = resolveDiffBase(cwd);
  const mergeBase = base
    ? git(["merge-base", base, "HEAD"], cwd)?.trim()
    : null;
  if (!base || !mergeBase) {
    return couldNotRun(
      base
        ? `could not find a merge-base between ${base} and HEAD`
        : "could not resolve a base ref (no GUARD_DIFF_BASE/GITHUB_BASE_REF, no origin/main or main)",
      "\n  Fix with:  git fetch origin main   (or set GUARD_DIFF_BASE=<ref>)",
    );
  }

  const diff = git(
    ["diff", "--name-status", "-z", "-M", "--diff-filter=ACMR", mergeBase],
    cwd,
  );
  // git diff does not list untracked files; a new file with a hatch is still new.
  const untracked = git(
    ["ls-files", "-z", "--others", "--exclude-standard"],
    cwd,
  );
  if (diff === null || untracked === null) {
    return couldNotRun(`could not list the files changed since ${mergeBase}`);
  }
  const changed = [
    ...parseNameStatus(diff),
    ...untracked
      .split("\0")
      .filter(Boolean)
      .map((file) => ({ path: file, basePath: null })),
  ].filter((file) => isInScope(file.path));

  const grown: string[] = [];
  for (const file of changed) {
    let headText: string;
    try {
      headText = readFileSync(path.join(cwd, file.path), "utf8");
    } catch (error) {
      return couldNotRun(
        `could not read ${file.path}: ${(error as Error).message}`,
      );
    }
    let baseCounts = emptyCounts();
    if (file.basePath !== null) {
      const baseText = git(["show", `${mergeBase}:${file.basePath}`], cwd);
      if (baseText === null) {
        return couldNotRun(
          `could not read ${file.basePath} at merge-base ${mergeBase}`,
        );
      }
      baseCounts = countEscapeHatches(baseText, file.basePath);
    }
    for (const g of growth(
      baseCounts,
      countEscapeHatches(headText, file.path),
    )) {
      grown.push(`  ${file.path}: ${g.kind} ${g.before} -> ${g.after}`);
    }
  }

  if (grown.length === 0) {
    return {
      code: 0,
      message: `${GUARD_NAME}: OK (${changed.length} changed TypeScript files, no escape hatches added since ${mergeBase.slice(0, 10)})`,
    };
  }
  return {
    code: 1,
    message:
      `${GUARD_NAME}: this branch added escape hatches that silence the type checker.\n\n` +
      `${grown.join("\n")}\n\n` +
      "Each of these turns a compile error into a runtime bug. Write the type instead: a real\n" +
      "interface, `unknown` plus narrowing, `satisfies`, or a type guard rather than `any`; check\n" +
      "for null/undefined rather than `!`; fix the type error rather than suppressing it with\n" +
      "@ts-ignore, @ts-expect-error, or a lint-disable comment. Removing an existing hatch in the\n" +
      "same file does not offset a new one of another kind. There is no opt-out pragma.",
  };
}

export function reportEscapeHatches(cwd: string): string {
  const files = git(["ls-files", "-z"], cwd);
  if (files === null) throw new Error("git ls-files failed");
  const totals = emptyCounts();
  const perFile: Array<[string, number]> = [];
  let scanned = 0;
  for (const file of files.split("\0").filter(isInScope)) {
    // A tracked file deleted in the working tree has nothing to count.
    if (!existsSync(path.join(cwd, file))) continue;
    const counts = countEscapeHatches(
      readFileSync(path.join(cwd, file), "utf8"),
      file,
    );
    scanned += 1;
    for (const kind of KINDS) totals[kind] += counts[kind];
    if (total(counts) > 0) perFile.push([file, total(counts)]);
  }
  perFile.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [
    `${GUARD_NAME} report: ${scanned} in-scope TypeScript files, ${total(totals)} escape hatches`,
    ...KINDS.map((kind) => `  ${kind.padEnd(16)}${totals[kind]}`),
    "",
    "Top 10 files:",
    ...perFile
      .slice(0, 10)
      .map(([file, count]) => `  ${String(count).padStart(5)}  ${file}`),
  ].join("\n");
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  if (process.argv.includes("--report")) {
    console.log(reportEscapeHatches(root));
    process.exit(0);
  }
  const outcome = runEscapeHatchGuard(root);
  (outcome.code === 0 ? console.log : console.error)(outcome.message);
  process.exit(outcome.code);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
