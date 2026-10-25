/**
 * guard-no-oracle-loosening.ts
 *
 * A test is the oracle. When an agent cannot make a failing test pass it can
 * weaken the oracle instead: skip or focus the test, drop an assertion, raise
 * retries, or let the runner pass with no tests. Red turns green without the
 * behaviour changing. This guard fails on lines THIS branch added (via
 * scripts/lib/changed-lines.mjs) that loosen an oracle without a visible reason.
 *
 *   disabled-test       test files: .skip( .only( .todo( .fixme( .skipIf( .runIf(
 *                       .skip.each( and xit( xdescribe( xtest(
 *   expect-anything     test files: expect.anything()
 *   runner-loosened     vitest.config.* / vitest.*.config.* / playwright.config.*:
 *                       retry / retries set to anything but 0, passWithNoTests
 *   script-loosened     package.json scripts: --passWithNoTests, vitest -u / --update
 *   assertions-removed  test files: removed expect( / assert( calls minus added
 *                       ones, per file. A deleted file counts all its removed
 *                       assertions. A renamed file is compared under its new path.
 *
 * Opt-out, with a reason of at least 10 characters:
 *
 *   // oracle-change: <reason>
 *
 * on the flagged added line or on the added line directly above it.
 * assertions-removed takes it on any added line in the file. A deleted file
 * takes `oracle-change(<path>): <reason>` on any added line in the diff.
 *
 * disabled-test and expect-anything are found with the TypeScript AST, not a
 * regex, so a `.skip(` inside a string or a comment (a fixture, say) is not a
 * test being skipped.
 *
 * Same diff-base contract as every changed-lines guard: a base that cannot be
 * resolved exits GUARD_EXIT_COULD_NOT_RUN, which run-guards.ts reports as
 * SKIPPED rather than as a pass.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  removedLines,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-oracle-loosening";
const rootDir = path.resolve(import.meta.dirname, "..");

const MIN_REASON_LENGTH = 10;
const TEST_FILE = /(?:\.(?:spec|test)\.tsx?|\.e2e\.ts)$|(?:^|\/)e2e\//;
const CONFIG_FILE =
  /(?:^|\/)(?:vitest\.config\.[^/]+|vitest\.[^/]+\.config\.[^/]+|playwright\.config\.[^/]+)$/;
const PACKAGE_JSON = /(?:^|\/)package\.json$/;
const ASSERTION = /\b(expect(\.soft)?|assert(\.\w+)?)\(/;
const DISABLING_PROPERTIES = new Set([
  "skip",
  "only",
  "todo",
  "fixme",
  "skipIf",
  "runIf",
]);
const DISABLING_IDENTIFIERS = new Set(["xit", "xdescribe", "xtest"]);
const PRAGMA = /(?:\/\/|\/\*|^\s*\*)\s*oracle-change:(.*)$/;
const RETRY = /\bretr(?:y|ies)\s*:\s*([^,}]+)/;
const PASS_WITH_NO_TESTS = /\bpassWithNoTests\b(?!\s*:\s*false\b)/;
const SCRIPT_ENTRY = /^\s*"([^"]+)"\s*:\s*"(.*)"\s*,?\s*$/;
const SCRIPT_FLAG = /--passWithNoTests\b|(?:^|\s)(?:-u|--update)(?=\s|$)/;

export interface ChangedFile {
  /** Current file contents, one entry per line. */
  source: string[];
  /** Line numbers this branch added. */
  added: ReadonlySet<number>;
}

export interface RemovedFile {
  /** Post-change repo path, or the pre-change path for a deleted file. */
  path: string;
  /** Pre-change repo path. Differs from `path` only for a rename. */
  oldPath: string;
  deleted: boolean;
  lines: { line: number; text: string }[];
}

export interface OracleChanges {
  root: string;
  /** Keyed by absolute path; files with no added lines may be absent. */
  added: ReadonlyMap<string, ChangedFile>;
  /** Keyed by absolute path, as `removedLines` returns it. */
  removed: ReadonlyMap<string, RemovedFile>;
}

export interface OracleViolation {
  file: string;
  line: number;
  rule: string;
  message: string;
}

export function isTestFile(relPath: string): boolean {
  return TEST_FILE.test(relPath);
}

function pragmaReason(text: string | undefined): string | null {
  const match = PRAGMA.exec(text ?? "");
  return match ? match[1].replace(/\*\/\s*$/, "").trim() : null;
}

function bestReason(reasons: (string | null)[]): string | null {
  const found = reasons.filter((reason): reason is string => reason !== null);
  return (
    found.find((reason) => reason.length >= MIN_REASON_LENGTH) ??
    found[0] ??
    null
  );
}

function optOutFor(file: ChangedFile, line: number): string | null {
  const above = file.added.has(line - 1)
    ? pragmaReason(file.source[line - 2])
    : null;
  return bestReason([pragmaReason(file.source[line - 1]), above]);
}

function reportable(message: string, reason: string | null): string | null {
  if (reason !== null && reason.length >= MIN_REASON_LENGTH) return null;
  if (reason === null) return message;
  return `${message} (oracle-change reason is shorter than ${MIN_REASON_LENGTH} characters)`;
}

function isIdentifierNamed(node: ts.Expression, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

const TEST_ROOTS = new Set(["it", "test", "describe", "suite", "bench"]);

// `stream.skip(2)` or `query.only(...)` are ordinary calls; only a chain that
// starts at a test API (`it.skip`, `test.describe.only`) disables a test.
function isTestApi(node: ts.Expression): boolean {
  let current = node;
  while (ts.isPropertyAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) && TEST_ROOTS.has(current.text);
}

// `toHaveBeenCalledWith(expect.anything(), id)` still pins `id`; only a matcher
// whose whole expected value is `expect.anything()` checks nothing.
function isWholeExpectedValue(call: ts.CallExpression): boolean {
  const parent = call.parent;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments.length === 1 &&
    parent.arguments[0] === call &&
    ts.isPropertyAccessExpression(parent.expression) &&
    parent.expression.name.text.startsWith("to")
  );
}

interface DisabledSite {
  line: number;
  rule: "disabled-test" | "expect-anything";
  what: string;
}

export function findDisabledTests(
  file: string,
  source: string,
): DisabledSite[] {
  const kind = /\.[cm]?tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const sites: DisabledSite[] = [];
  const at = (node: ts.Node, site: Omit<DisabledSite, "line">) => {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    sites.push({ line, ...site });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && DISABLING_IDENTIFIERS.has(callee.text)) {
        at(callee, { rule: "disabled-test", what: `${callee.text}(` });
      } else if (ts.isPropertyAccessExpression(callee)) {
        const name = callee.name.text;
        const inner = callee.expression;
        if (DISABLING_PROPERTIES.has(name) && isTestApi(inner)) {
          at(callee.name, { rule: "disabled-test", what: `.${name}(` });
        } else if (
          name === "anything" &&
          isIdentifierNamed(inner, "expect") &&
          isWholeExpectedValue(node)
        ) {
          at(callee.name, {
            rule: "expect-anything",
            what: "expect.anything()",
          });
        } else if (
          name === "each" &&
          ts.isPropertyAccessExpression(inner) &&
          DISABLING_PROPERTIES.has(inner.name.text) &&
          isTestApi(inner.expression)
        ) {
          at(inner.name, {
            rule: "disabled-test",
            what: `.${inner.name.text}.each(`,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

function sortedAdded(file: ChangedFile): number[] {
  return [...file.added].sort((a, b) => a - b);
}

function checkTestFile(
  rel: string,
  file: ChangedFile,
  report: (
    line: number,
    rule: string,
    message: string,
    reason: string | null,
  ) => void,
) {
  for (const site of findDisabledTests(rel, file.source.join("\n"))) {
    if (!file.added.has(site.line)) continue;
    const message =
      site.rule === "expect-anything"
        ? "expect.anything() matches any value, so the assertion checks nothing"
        : `added ${site.what} turns off or narrows a test`;
    report(site.line, site.rule, message, optOutFor(file, site.line));
  }
}

function checkRunnerConfig(
  file: ChangedFile,
  report: (
    line: number,
    rule: string,
    message: string,
    reason: string | null,
  ) => void,
) {
  for (const line of sortedAdded(file)) {
    const text = file.source[line - 1] ?? "";
    const retry = RETRY.exec(text);
    if (retry) {
      const value = retry[1].replace(/\/\/.*$/, "").trim();
      if (value !== "0") {
        report(
          line,
          "runner-loosened",
          `retry set to ${value}; a failing test is re-run until one attempt passes`,
          optOutFor(file, line),
        );
      }
    }
    if (PASS_WITH_NO_TESTS.test(text)) {
      report(
        line,
        "runner-loosened",
        "passWithNoTests lets a run with no tests pass",
        optOutFor(file, line),
      );
    }
  }
}

function checkPackageScripts(
  file: ChangedFile,
  report: (
    line: number,
    rule: string,
    message: string,
    reason: string | null,
  ) => void,
) {
  for (const line of sortedAdded(file)) {
    const entry = SCRIPT_ENTRY.exec(file.source[line - 1] ?? "");
    const flag = entry ? SCRIPT_FLAG.exec(entry[2]) : null;
    if (!entry || !flag) continue;
    report(
      line,
      "script-loosened",
      `script "${entry[1]}" adds ${flag[0].trim()}`,
      optOutFor(file, line),
    );
  }
}

function deletedFileReason(
  oldPath: string,
  added: ReadonlyMap<string, ChangedFile>,
): string | null {
  const marker = `oracle-change(${oldPath}):`;
  const reasons: string[] = [];
  for (const file of added.values()) {
    for (const line of file.added) {
      const text = file.source[line - 1] ?? "";
      const at = text.indexOf(marker);
      if (at !== -1) {
        reasons.push(
          text
            .slice(at + marker.length)
            .replace(/\*\/\s*$/, "")
            .trim(),
        );
      }
    }
  }
  return bestReason(reasons);
}

/**
 * Pure: takes the changed files and removed lines, returns violations. The
 * glue in main() only reads the files and calls this.
 */
export function findOracleLoosening(changes: OracleChanges): OracleViolation[] {
  const violations: OracleViolation[] = [];
  const relOf = (abs: string) =>
    path.relative(changes.root, abs).replace(/\\/g, "/");

  for (const [abs, file] of changes.added) {
    const rel = relOf(abs);
    const report = (
      line: number,
      rule: string,
      message: string,
      reason: string | null,
    ) => {
      const text = reportable(message, reason);
      if (text !== null)
        violations.push({ file: rel, line, rule, message: text });
    };
    if (isTestFile(rel)) checkTestFile(rel, file, report);
    if (CONFIG_FILE.test(rel)) checkRunnerConfig(file, report);
    if (PACKAGE_JSON.test(rel)) checkPackageScripts(file, report);
  }

  for (const [abs, removed] of changes.removed) {
    if (!isTestFile(removed.path) && !isTestFile(removed.oldPath)) continue;
    const gone = removed.lines.filter((entry) => ASSERTION.test(entry.text));
    const current = removed.deleted ? undefined : changes.added.get(abs);
    const addedAssertions = current
      ? sortedAdded(current).filter((line) =>
          ASSERTION.test(current.source[line - 1] ?? ""),
        ).length
      : 0;
    const net = gone.length - addedAssertions;
    if (gone.length === 0 || net <= 0) continue;

    const reason = removed.deleted
      ? deletedFileReason(removed.oldPath, changes.added)
      : bestReason(
          current
            ? sortedAdded(current).map((line) =>
                pragmaReason(current.source[line - 1]),
              )
            : [],
        );
    const message = `removed ${gone.length} assertion line(s) and added ${addedAssertions}${removed.deleted ? " (file deleted)" : ""}`;
    const text = reportable(message, reason);
    if (text !== null) {
      violations.push({
        file: removed.path,
        line: gone[0].line,
        rule: "assertions-removed",
        message: text,
      });
    }
  }
  return violations;
}

function readChangedFile(
  absPath: string,
  added: ReadonlySet<number>,
): ChangedFile {
  try {
    return { source: readFileSync(absPath, "utf8").split("\n"), added };
  } catch (error) {
    console.error(
      `${GUARD_NAME}: could not read ${absPath}: ${(error as Error).message}`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
}

function main() {
  const added = requireAddedLines(rootDir, GUARD_NAME);
  const removed = removedLines(rootDir);
  if (removed === null) {
    console.error(
      `${GUARD_NAME}: could not read the removed lines from git diff, so the ` +
        "check did not run.\n" +
        "  Fix with:  git fetch origin main   (or set GUARD_DIFF_BASE=<ref>)",
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  const changed = new Map<string, ChangedFile>();
  for (const [absPath, lines] of added) {
    changed.set(absPath, readChangedFile(absPath, lines));
  }

  const violations = findOracleLoosening({
    root: rootDir,
    added: changed,
    removed,
  });
  if (violations.length === 0) {
    console.log(`${GUARD_NAME}: OK (${added.size} changed file(s) inspected)`);
    return;
  }

  console.error(
    `${GUARD_NAME}: ${violations.length} oracle loosening(s) added.`,
  );
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}: ${violation.rule} — ${violation.message}`,
    );
  }
  console.error(
    "  fix: restore the removed assertion or test, or add `oracle-change: <reason>` " +
      "(10+ characters) on the flagged line or the line above, naming the behaviour " +
      "that changed; a deleted file takes `oracle-change(<path>): <reason>`",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
