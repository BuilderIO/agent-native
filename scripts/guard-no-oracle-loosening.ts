/**
 * guard-no-oracle-loosening.ts
 *
 * A test is the oracle. When an agent cannot make a failing test pass it can
 * weaken the oracle instead: skip or focus the test, drop an assertion, raise
 * retries, or let the runner pass with no tests. Red turns green without the
 * behaviour changing. This guard fails on lines THIS branch added (via
 * scripts/lib/changed-lines.mjs) that loosen an oracle without a visible reason.
 *
 *   disabled-test       test files: .skip( .only( .todo( .fixme( .fails( .skipIf(
 *                       .runIf( .skip.each( and xit( xdescribe( xtest(, also
 *                       when chained after a call such as it.each(rows).skip(,
 *                       and with a literal key: it["skip"](
 *   expect-anything     test files: expect.anything()
 *   runner-loosened     vitest.config.* / vitest.*.config.* / playwright.config.*:
 *                       retry / retries set to anything but 0, passWithNoTests.
 *                       Test files: retry / retries in a test API's options
 *                       object, test.describe.configure({ retries }), and
 *                       .retries(N) with N other than 0
 *   script-loosened     package.json scripts: --passWithNoTests, vitest -u / --update
 *   assertions-removed  test files: fewer expect( / expect.soft|poll|element( / assert( /
 *                       assert.x( calls than before, counted in the AST of the
 *                       file at the merge-base and of the file now, with each
 *                       file's own import aliases (`import { expect as check }`,
 *                       `import assert from "node:assert"`, `v.expect(` after
 *                       `import * as v`). A deleted file counts all its calls
 *                       as removed; a new file had none.
 *                       A renamed file is compared old path against new path.
 *
 * Opt-out, with a reason of at least 10 characters:
 *
 *   // oracle-change: <reason>
 *
 * on the flagged added line or on the added line directly above it.
 * assertions-removed takes it on any added line in the file. A deleted file
 * takes `oracle-change(<path>): <reason>` on any added line in the diff.
 * The pragma counts only inside a comment. In TypeScript or JavaScript, text
 * in a string or template literal is not a reason. JSON has no comments, so
 * package.json keeps the older line match.
 *
 * disabled-test, expect-anything and assertions-removed are found with the
 * TypeScript AST, not a regex, so a `.skip(` or `expect(` inside a string or a
 * comment (a fixture, say) is not a test being skipped or an assertion.
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
  diffBaseCommit,
  readCommitFile,
  removedLines,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-oracle-loosening";
const rootDir = path.resolve(import.meta.dirname, "..");

const MIN_REASON_LENGTH = 10;
const PRAGMA_MARKER = "oracle-change:";
const TEST_FILE =
  /(?:\.(?:spec|test)\.(?:tsx?|jsx?|mjs|cjs)|\.e2e\.(?:tsx?|jsx?|mjs|cjs))$|(?:^|\/)e2e\//;
const CONFIG_FILE =
  /(?:^|\/)(?:vitest\.config\.[^/]+|vitest\.[^/]+\.config\.[^/]+|playwright\.config\.[^/]+)$/;
const PACKAGE_JSON = /(?:^|\/)package\.json$/;
const JSON_FILE = /\.json$/i;
const DISABLING_PROPERTIES = new Set([
  "skip",
  "only",
  "todo",
  "fixme",
  "fails",
  "skipIf",
  "runIf",
]);
const DISABLING_IDENTIFIERS = new Set(["xit", "xdescribe", "xtest"]);
const RETRY_PROPERTIES = new Set(["retry", "retries"]);
const TEST_MODULES = new Set([
  "vitest",
  "@playwright/test",
  "node:test",
  "bun:test",
]);
const ASSERT_MODULES = new Set([
  "assert",
  "assert/strict",
  "node:assert",
  "node:assert/strict",
]);
// package.json has no comments, so its pragma is matched on the line.
const JSON_PRAGMA = /(?:\/\/|\/\*|^\s*\*)\s*oracle-change:(.*)$/;
// Run on the part of one line that lies inside a comment.
const COMMENT_PRAGMA = /oracle-change(?:\([^)]*\))?:.*$/;
const RETRY = /\bretr(?:y|ies)\s*:\s*([^,}]+)/;
const PASS_WITH_NO_TESTS = /\bpassWithNoTests\b(?!\s*:\s*false\b)/;
const SCRIPT_ENTRY = /^\s*"([^"]+)"\s*:\s*"(.*)"\s*,?\s*$/;
const SCRIPT_FLAG = /--passWithNoTests\b|(?:^|\s)(?:-u|--update)(?=\s|$)/;

export interface ChangedFile {
  /** Current file contents, one entry per line. */
  source: string[];
  /** Line numbers this branch added. */
  added: ReadonlySet<number>;
  /** Pragma texts by line, from `pragmasIn`; each starts at `oracle-change`. */
  pragmas: ReadonlyMap<number, readonly string[]>;
}

export interface RemovedFile {
  /** Post-change repo path, or the pre-change path for a deleted file. */
  path: string;
  /** Pre-change repo path. Differs from `path` only for a rename. */
  oldPath: string;
  deleted: boolean;
  /** New on this branch: there is no pre-change file. */
  created: boolean;
  lines: { line: number; text: string }[];
}

export interface AssertionSource {
  /** Text at the merge-base; null when the file is new on this branch. */
  base: string | null;
  /** Text now; null when the file was deleted. */
  next: string | null;
}

export interface OracleChanges {
  root: string;
  /** Keyed by absolute path; files with no added lines may be absent. */
  added: ReadonlyMap<string, ChangedFile>;
  /** Keyed by absolute path, as `removedLines` returns it. */
  removed: ReadonlyMap<string, RemovedFile>;
  /** Keyed like `removed`. Every changed test file in `removed` needs one. */
  assertionSources: ReadonlyMap<string, AssertionSource>;
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

function scriptKind(file: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function commentRanges(file: string, source: string): ts.CommentRange[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const ranges = new Map<number, ts.CommentRange>();
  const jsxText: [start: number, end: number][] = [];
  // A comment on the token's own line is trailing trivia of the token before
  // it; one on a later line is leading trivia of the token after. getChildren
  // yields every token, so visiting each node's two edges reaches every comment.
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) jsxText.push([node.pos, node.end]);
    const comments = [
      ...(ts.getLeadingCommentRanges(source, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.end) ?? []),
    ];
    for (const range of comments) ranges.set(range.pos, range);
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  // JSX text is content: `// x` between tags is not a comment.
  return [...ranges.values()].filter(
    (range) =>
      !jsxText.some(([start, end]) => range.pos >= start && range.pos < end),
  );
}

/**
 * Pragma texts per line, each starting at `oracle-change`. Only text inside a
 * comment counts, so a string that holds the pragma opts nothing out.
 */
export function pragmasIn(file: string, source: string): Map<number, string[]> {
  const pragmas = new Map<number, string[]>();
  const add = (line: number, tail: string) => {
    pragmas.set(line, [...(pragmas.get(line) ?? []), tail]);
  };
  const lines = source.split("\n");

  if (JSON_FILE.test(file)) {
    lines.forEach((text, index) => {
      const match = JSON_PRAGMA.exec(text);
      if (match) add(index + 1, `${PRAGMA_MARKER}${match[1]}`);
    });
    return pragmas;
  }

  const comments = commentRanges(file, source);
  let lineStart = 0;
  lines.forEach((text, index) => {
    const lineEnd = lineStart + text.length;
    for (const comment of comments) {
      const from = Math.max(comment.pos, lineStart);
      const to = Math.min(comment.end, lineEnd);
      if (from >= to) continue;
      const match = COMMENT_PRAGMA.exec(source.slice(from, to));
      if (match) add(index + 1, match[0]);
    }
    lineStart = lineEnd + 1;
  });
  return pragmas;
}

function reasonAfter(tail: string, marker: string): string | null {
  if (!tail.startsWith(marker)) return null;
  return tail
    .slice(marker.length)
    .replace(/\*\/\s*$/, "")
    .trim();
}

function reasonsOn(
  pragmas: ReadonlyMap<number, readonly string[]>,
  line: number,
  marker: string,
): string[] {
  return (pragmas.get(line) ?? []).flatMap(
    (tail) => reasonAfter(tail, marker) ?? [],
  );
}

function bestReason(reasons: string[]): string | null {
  return (
    reasons.find((reason) => reason.length >= MIN_REASON_LENGTH) ??
    reasons[0] ??
    null
  );
}

function optOutFor(file: ChangedFile, line: number): string | null {
  const above = file.added.has(line - 1)
    ? reasonsOn(file.pragmas, line - 1, PRAGMA_MARKER)
    : [];
  return bestReason([
    ...reasonsOn(file.pragmas, line, PRAGMA_MARKER),
    ...above,
  ]);
}

function reportable(message: string, reason: string | null): string | null {
  if (reason !== null && reason.length >= MIN_REASON_LENGTH) return null;
  if (reason === null) return message;
  return `${message} (oracle-change reason is shorter than ${MIN_REASON_LENGTH} characters)`;
}

const TEST_ROOTS = new Set(["it", "test", "describe", "suite", "bench"]);

interface ImportScope {
  /** The globals plus any local name a test runner import gives a test API. */
  roots: ReadonlySet<string>;
  /** Namespace imports of a test runner: `v` in `import * as v from "vitest"`. */
  namespaces: ReadonlySet<string>;
  /** `expect` plus any local name a test runner import gives `expect`. */
  expectRoots: ReadonlySet<string>;
  /** `assert` plus the default or namespace import of an assert module. */
  assertRoots: ReadonlySet<string>;
}

// Collected from one file's own text: `import { it as spec } from "vitest"`
// makes `spec` a root, `import * as v from "vitest"` makes `v.it` one, and
// `import { expect as check } from "vitest"` makes `check(x)` an assertion. A
// name from any other module does not become a root, however it is spelled.
function importScope(sourceFile: ts.SourceFile): ImportScope {
  const roots = new Set(TEST_ROOTS);
  const namespaces = new Set<string>();
  const expectRoots = new Set(["expect"]);
  const assertRoots = new Set(["assert"]);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const module = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (ASSERT_MODULES.has(module)) {
      if (clause?.name !== undefined) assertRoots.add(clause.name.text);
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        assertRoots.add(bindings.name.text);
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          assertRoots.add(element.name.text);
        }
      }
      continue;
    }
    if (!TEST_MODULES.has(module) || bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (TEST_ROOTS.has(imported)) roots.add(element.name.text);
      if (imported === "expect") expectRoots.add(element.name.text);
    }
  }
  return { roots, namespaces, expectRoots, assertRoots };
}

interface Member {
  /** The expression the member is read from: `it` in `it.skip`. */
  object: ts.Expression;
  name: string;
  /** Where a finding about the member points: the name, or the string key. */
  site: ts.Node;
}

// `it.skip` and `it["skip"]` read the same member. A computed key counts only
// when it is a string literal: `it[name]` could be any member at all.
function memberOf(node: ts.Expression): Member | null {
  if (ts.isPropertyAccessExpression(node)) {
    return { object: node.expression, name: node.name.text, site: node.name };
  }
  if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) {
      return { object: node.expression, name: key.text, site: key };
    }
  }
  return null;
}

// `stream.skip(2)` or `query.only(...)` are ordinary calls; only a chain that
// starts at a test API (`it.skip`, `test.describe.only`, `it.each(rows).skip`)
// disables a test. Calls are walked like member reads to reach the root.
function isTestApi(node: ts.Expression, scope: ImportScope): boolean {
  const names: string[] = [];
  let base: ts.Expression = node;
  for (;;) {
    const member = memberOf(base);
    if (member !== null) {
      names.unshift(member.name);
      base = member.object;
    } else if (ts.isCallExpression(base)) {
      base = base.expression;
    } else {
      break;
    }
  }
  if (!ts.isIdentifier(base)) return false;
  if (scope.roots.has(base.text)) return true;
  return (
    scope.namespaces.has(base.text) &&
    names.length > 0 &&
    TEST_ROOTS.has(names[0])
  );
}

function isLiteralZero(node: ts.Node): boolean {
  return ts.isNumericLiteral(node) && node.text === "0";
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

// `.fails(` inverts the test: a failing assertion is reported as a pass.
function disabledMessage(what: string): string {
  return what.startsWith(".fails")
    ? `added ${what} makes a failing assertion read as passing`
    : `added ${what} turns off or narrows a test`;
}

interface DisabledSite {
  line: number;
  rule: "disabled-test" | "expect-anything" | "runner-loosened";
  message: string;
}

export function findDisabledTests(
  file: string,
  source: string,
): DisabledSite[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const scope = importScope(sourceFile);
  const sites: DisabledSite[] = [];
  const at = (node: ts.Node, site: Omit<DisabledSite, "line">) => {
    sites.push({ line: lineOf(sourceFile, node), ...site });
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const member = memberOf(callee);
      if (ts.isIdentifier(callee) && DISABLING_IDENTIFIERS.has(callee.text)) {
        at(callee, {
          rule: "disabled-test",
          message: disabledMessage(`${callee.text}(`),
        });
      } else if (member !== null) {
        const { name, object: inner, site } = member;
        if (DISABLING_PROPERTIES.has(name) && isTestApi(inner, scope)) {
          at(site, {
            rule: "disabled-test",
            message: disabledMessage(`.${name}(`),
          });
        } else if (
          name === "anything" &&
          ts.isIdentifier(inner) &&
          scope.expectRoots.has(inner.text) &&
          isWholeExpectedValue(node)
        ) {
          at(site, {
            rule: "expect-anything",
            message:
              "expect.anything() matches any value, so the assertion checks nothing",
          });
        } else if (name === "each") {
          const disabled = memberOf(inner);
          if (
            disabled !== null &&
            DISABLING_PROPERTIES.has(disabled.name) &&
            isTestApi(disabled.object, scope)
          ) {
            at(disabled.site, {
              rule: "disabled-test",
              message: disabledMessage(`.${disabled.name}.each(`),
            });
          }
        }
      }

      // `.retries(N)` is mocha's `this.retries(N)`; any receiver counts.
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "retries"
      ) {
        const [count] = node.arguments;
        if (count !== undefined && !isLiteralZero(count)) {
          at(callee.name, {
            rule: "runner-loosened",
            message: `retries(${count.getText(sourceFile)}) re-runs a failing test until one attempt passes`,
          });
        }
      } else if (isTestApi(callee, scope)) {
        // Covers `it(..., { retry })`, `it.each(rows)(..., { retries })` and
        // `test.describe.configure({ retries })`: an options object passed to
        // a test API, in any argument position.
        for (const arg of node.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          for (const prop of arg.properties) {
            if (
              !ts.isPropertyAssignment(prop) &&
              !ts.isShorthandPropertyAssignment(prop)
            ) {
              continue;
            }
            const key = prop.name;
            if (
              !(ts.isIdentifier(key) || ts.isStringLiteral(key)) ||
              !RETRY_PROPERTIES.has(key.text)
            ) {
              continue;
            }
            if (
              ts.isPropertyAssignment(prop) &&
              isLiteralZero(prop.initializer)
            ) {
              continue;
            }
            const value = ts.isPropertyAssignment(prop)
              ? prop.initializer.getText(sourceFile)
              : key.text;
            at(key, {
              rule: "runner-loosened",
              message: `${key.text} set to ${value}; a failing test is re-run until one attempt passes`,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

const EXPECT_VARIANTS = new Set(["soft", "poll", "element"]);

// The member reads under a callee, root first: `v.expect.soft` gives `v` and
// ["expect", "soft"]. Calls are not walked, so `expect(x).toBe` has no root.
function memberChain(callee: ts.Expression): {
  root: ts.Expression;
  names: string[];
} {
  const names: string[] = [];
  let root = callee;
  for (let member = memberOf(root); member !== null; member = memberOf(root)) {
    names.unshift(member.name);
    root = member.object;
  }
  return { root, names };
}

// `expect(...)`, `expect.soft/poll/element(...)`, `assert(...)` and
// `assert.x(...)`, through a file's own aliases and namespace imports: the calls
// an oracle is made of. Matched on the callee, so `expect(` inside a string or
// comment is not one, and a chained `expect(x).toBe(y)` counts once, at the
// inner `expect(x)`.
function isAssertionCall(call: ts.CallExpression, scope: ImportScope): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return (
      scope.expectRoots.has(callee.text) || scope.assertRoots.has(callee.text)
    );
  }
  const { root, names } = memberChain(callee);
  if (!ts.isIdentifier(root)) return false;
  if (scope.assertRoots.has(root.text)) return true;
  if (scope.expectRoots.has(root.text)) {
    return names.length === 1 && EXPECT_VARIANTS.has(names[0]);
  }
  if (scope.namespaces.has(root.text)) {
    // `v.expect(x)` and `v.expect.soft(x)` after `import * as v`.
    return (
      names[0] === "expect" &&
      (names.length === 1 ||
        (names.length === 2 && EXPECT_VARIANTS.has(names[1])))
    );
  }
  return false;
}

/**
 * Lines of the assertion calls in `source`. `scope` defaults to the aliases
 * `source` itself imports, so each text is read with its own imports.
 */
function assertionCallLines(
  file: string,
  source: string | null,
  scope?: ImportScope,
): number[] {
  if (source === null) return [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const aliases = scope ?? importScope(sourceFile);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isAssertionCall(node, aliases)) {
      lines.push(lineOf(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return lines;
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
    report(site.line, site.rule, site.message, optOutFor(file, site.line));
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
      reasons.push(...reasonsOn(file.pragmas, line, marker));
    }
  }
  return bestReason(reasons);
}

/**
 * Pure: takes the changed files, removed lines and both sides of each changed
 * test file, returns violations. The glue in main() only reads and calls this.
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
    const sources = changes.assertionSources.get(abs);
    if (sources === undefined) {
      throw new Error(
        `${GUARD_NAME}: no assertion sources for ${removed.path}; both sides of every changed test file must be read`,
      );
    }
    // A file new on this branch had no assertions to lose.
    if (sources.base === null) continue;
    const baseScope = importScope(
      ts.createSourceFile(
        removed.oldPath,
        sources.base,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(removed.oldPath),
      ),
    );
    const before = assertionCallLines(removed.oldPath, sources.base).length;
    const after = assertionCallLines(removed.path, sources.next).length;
    if (after >= before) continue;

    const current = removed.deleted ? undefined : changes.added.get(abs);
    const reason = removed.deleted
      ? deletedFileReason(removed.oldPath, changes.added)
      : bestReason(
          current
            ? sortedAdded(current).flatMap((line) =>
                reasonsOn(current.pragmas, line, PRAGMA_MARKER),
              )
            : [],
        );
    // A removed line is parsed alone, so it takes the base file's aliases.
    const location =
      removed.lines.find(
        (entry) =>
          assertionCallLines(removed.oldPath, entry.text, baseScope).length > 0,
      ) ?? removed.lines[0];
    if (location === undefined) {
      throw new Error(
        `${GUARD_NAME}: ${removed.path} lost ${before - after} assertion call(s) but the diff has no removed line for it`,
      );
    }
    const message = `removed ${before - after} assertion call(s): ${before} before, ${after} now${removed.deleted ? " (file deleted)" : ""}`;
    const text = reportable(message, reason);
    if (text !== null) {
      violations.push({
        file: removed.path,
        line: location.line,
        rule: "assertions-removed",
        message: text,
      });
    }
  }
  return violations;
}

function readText(absPath: string): string {
  try {
    return readFileSync(absPath, "utf8");
  } catch (error) {
    console.error(
      `${GUARD_NAME}: could not read ${absPath}: ${(error as Error).message}`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
}

function readChangedFile(
  absPath: string,
  added: ReadonlySet<number>,
): ChangedFile {
  const source = readText(absPath);
  return {
    source: source.split("\n"),
    added,
    pragmas: pragmasIn(absPath, source),
  };
}

function main() {
  const added = requireAddedLines(rootDir, GUARD_NAME);
  const removed = removedLines(rootDir);
  const base = diffBaseCommit(rootDir);
  if (removed === null || base === null) {
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

  const assertionSources = new Map<string, AssertionSource>();
  for (const [absPath, entry] of removed) {
    if (!isTestFile(entry.path) && !isTestFile(entry.oldPath)) continue;
    assertionSources.set(absPath, {
      base: entry.created ? null : readCommitFile(rootDir, base, entry.oldPath),
      next: entry.deleted ? null : readText(absPath),
    });
  }

  const violations = findOracleLoosening({
    root: rootDir,
    added: changed,
    removed,
    assertionSources,
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
      "(10+ characters) in a comment on the flagged line or the line above, naming the " +
      "behaviour that changed; a deleted file takes `oracle-change(<path>): <reason>`",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
