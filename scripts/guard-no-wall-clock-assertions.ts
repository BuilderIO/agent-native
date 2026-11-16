/**
 * guard-no-wall-clock-assertions.ts
 *
 * A test that asserts on elapsed real time, `expect(Date.now() - startedAt)
 * .toBeLessThan(1_000)`, measures the machine as much as the code. On a busy
 * CI runner the same correct run takes several times longer, so the bound
 * fails sooner or later. On 2026-11-13 two such tests turned the stable
 * release PR's required "Fast tests" check red: one read `expected 1240 to be
 * less than 1000`, the other launched Chrome inside a 30 s test on a runner
 * that spent 372 s importing.
 *
 * This guard fails on lines THIS branch added (via
 * scripts/lib/changed-lines.mjs) in test files (*.spec.* / *.test.*) that
 * assert on elapsed wall-clock time:
 *
 *   - `expect(<elapsed>)` followed by a comparison matcher (toBeLessThan,
 *     toBeGreaterThan, toBe, toEqual, toBeCloseTo, toBeTruthy, ...), and
 *     `assert(...)` / `assert.<method>(...)` with an elapsed argument;
 *   - where <elapsed> is a subtraction with a clock read on either side
 *     (`Date.now()`, `performance.now()`, `process.hrtime.bigint()`,
 *     `new Date().getTime()`) or a variable that holds one
 *     (`const startedAt = Date.now()`), a variable holding such a
 *     subtraction (`const elapsed = performance.now() - start`), or
 *     arithmetic, a comparison or Math.round/floor/... on one of those.
 *
 * An assertion that runs under fake timers is skipped: there `Date.now()` is
 * the test's own clock and an exact elapsed value is deterministic. Fake
 * timers count as on when the nearest switch before the assertion in an
 * enclosing function is `vi.useFakeTimers` / `vi.setSystemTime` (or the jest,
 * sinon and node:test `mock.timers.enable` spellings, or a local helper that
 * makes one) rather than `useRealTimers`, or when a `beforeEach`/`beforeAll`
 * of an enclosing describe block or the file turns them on. A sibling test's
 * fake clock does not count.
 *
 * Replace the bound with what it was standing in for:
 *
 *   - "fails fast" / "does not hang": assert the structural fact - no waiter
 *     queued, no timer scheduled, the retry or call count;
 *   - timeout, retry, debounce or backoff logic: `vi.useFakeTimers()` and
 *     `vi.advanceTimersByTime()`, or inject a clock;
 *   - a real performance budget (a ReDoS guard, parser speed): `measureCpuMs`
 *     from `@agent-native/core/testing/cpu-time`, which counts CPU time and
 *     not the time a loaded runner spends on other work, or a scaling check
 *     (n against 4n).
 *
 * When real elapsed time really is the subject (a live network deadline with
 * nothing to fake), opt out with a reason of at least 10 characters:
 *
 *   // wall-clock-ok: <reason>
 *
 * inside a comment on any line of the assertion, or anywhere in the comment
 * block directly above it.
 *
 * Usage:
 *   tsx scripts/guard-no-wall-clock-assertions.ts         diff-scoped (CI)
 *   tsx scripts/guard-no-wall-clock-assertions.ts --all   every tracked test
 *       file, ignoring the diff. For MEASUREMENT ONLY: it lists the backlog
 *       and exits 0. Not a CI mode.
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
  execGuardCommand,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-wall-clock-assertions";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /wall-clock-ok:(.*)$/;
const MIN_REASON_LENGTH = 10;
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
const SKIPPED_PATH =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.output|\.generated)\//;

const COMPARISON_MATCHERS = new Set([
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toBeCloseTo",
  "toBeTruthy",
  "toBeFalsy",
]);
const MATCHER_MODIFIERS = new Set(["not", "resolves", "rejects"]);

export const FIX_HINT =
  "Replace the elapsed-time bound with what it stands for:\n" +
  '  - "fails fast" / "does not hang": assert the structural fact (no waiter\n' +
  "    queued, no timer scheduled, the retry or call count);\n" +
  "  - timeout, retry, debounce or backoff logic: vi.useFakeTimers() and\n" +
  "    vi.advanceTimersByTime(), or inject a clock;\n" +
  "  - a real performance budget: measureCpuMs from\n" +
  '    "@agent-native/core/testing/cpu-time" (CPU time, not wall time), or a\n' +
  "    scaling check (n against 4n).\n" +
  "Do not raise the number: a loaded runner crosses any fixed bound.\n\n" +
  "If real elapsed time really is the subject, opt out in a comment on the\n" +
  "assertion or directly above it, with a reason of 10+ characters:\n" +
  "  // wall-clock-ok: <reason>";

export interface WallClockFinding {
  file: string;
  line: number;
  snippet: string;
  /** Set when an opt-out was present but its reason too short. */
  shortReason?: true;
}

export function isTestFilePath(relPath: string): boolean {
  return TEST_FILE.test(relPath) && !SKIPPED_PATH.test(relPath);
}

function scriptKind(file: string): ts.ScriptKind {
  return /\.[cm]?[jt]sx$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isIdentifierNamed(node: ts.Expression, name: string): boolean {
  const target = unwrap(node);
  return ts.isIdentifier(target) && target.text === name;
}

/** `performance`, `globalThis.performance`, `window.performance`, ... */
function namesGlobal(node: ts.Expression, name: string): boolean {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return target.text === name;
  return ts.isPropertyAccessExpression(target) && target.name.text === name;
}

/** Date.now(), performance.now(), process.hrtime.bigint(), new Date().getTime(). */
function isClockRead(node: ts.Expression): boolean {
  const target = unwrap(node);
  if (!ts.isCallExpression(target)) return false;
  const callee = unwrap(target.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  const receiver = unwrap(callee.expression);
  if (method === "now") {
    return (
      namesGlobal(receiver, "Date") || namesGlobal(receiver, "performance")
    );
  }
  if (method === "bigint") {
    return (
      ts.isPropertyAccessExpression(receiver) &&
      receiver.name.text === "hrtime" &&
      isIdentifierNamed(receiver.expression, "process")
    );
  }
  if (method === "getTime" || method === "valueOf") {
    return (
      ts.isNewExpression(receiver) &&
      isIdentifierNamed(receiver.expression, "Date") &&
      (receiver.arguments?.length ?? 0) === 0
    );
  }
  return false;
}

/** An identifier read as a value, not a property name or a declared name. */
function isValueReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    return false;
  }
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return true;
}

interface ClockNames {
  /** Variables holding a clock read: `const startedAt = Date.now()`. */
  clocks: Set<string>;
  /** Variables holding an elapsed time: `const elapsed = Date.now() - t0`. */
  elapsed: Set<string>;
}

function isClockValued(node: ts.Expression, names: ClockNames): boolean {
  const target = unwrap(node);
  return (
    isClockRead(target) ||
    (ts.isIdentifier(target) && names.clocks.has(target.text))
  );
}

const DERIVING_OPERATORS = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
]);
const NUMERIC_WRAPPERS =
  /^(?:Math\.(?:round|floor|ceil|trunc|abs|min|max)|Number)$/;

/**
 * Whether the value of `node` is an elapsed wall-clock time, or arithmetic or
 * a comparison on one: `Date.now() - t0`, `elapsed / 1000`, `elapsed < 50`,
 * `Math.round(performance.now() - t0)`. Only the value itself counts, so an
 * object or call that merely holds such an expression somewhere inside it
 * (`run({ since: Date.now() - 1_000 })`) is not elapsed time.
 */
function isElapsedValue(node: ts.Expression, names: ClockNames): boolean {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) {
    return names.elapsed.has(target.text) && isValueReference(target);
  }
  if (ts.isBinaryExpression(target)) {
    const operator = target.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.MinusToken &&
      (isClockValued(target.left, names) || isClockValued(target.right, names))
    ) {
      return true;
    }
    return (
      DERIVING_OPERATORS.has(operator) &&
      (isElapsedValue(target.left, names) ||
        isElapsedValue(target.right, names))
    );
  }
  if (ts.isPrefixUnaryExpression(target)) {
    return isElapsedValue(target.operand, names);
  }
  if (ts.isCallExpression(target)) {
    const callee = propertyChain(target.expression)?.join(".") ?? "";
    return (
      NUMERIC_WRAPPERS.test(callee) &&
      target.arguments.some((argument) => isElapsedValue(argument, names))
    );
  }
  return false;
}

function collectClockNames(sourceFile: ts.SourceFile): ClockNames {
  const names: ClockNames = { clocks: new Set(), elapsed: new Set() };
  const bindings: [name: string, value: ts.Expression][] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      bindings.push([node.name.text, node.initializer]);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      bindings.push([node.left.text, node.right]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // An elapsed variable can be derived from another one, so iterate until
  // nothing new is learned.
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, value] of bindings) {
      if (isClockRead(value)) {
        if (!names.clocks.has(name)) {
          names.clocks.add(name);
          changed = true;
        }
      } else if (!names.elapsed.has(name) && isElapsedValue(value, names)) {
        names.elapsed.add(name);
        changed = true;
      }
    }
  }
  return names;
}

function propertyChain(node: ts.Expression): string[] | null {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return [target.text];
  if (ts.isPropertyAccessExpression(target)) {
    const head = propertyChain(target.expression);
    return head ? [...head, target.name.text] : null;
  }
  return null;
}

const FAKE_TIMERS_ON =
  /^(?:(?:vi|jest)\.(?:useFakeTimers|setSystemTime)|sinon\.useFakeTimers|(?:.+\.)?mock\.timers\.enable)$/;
const FAKE_TIMERS_OFF =
  /^(?:(?:vi|jest)\.useRealTimers|(?:.+\.)?mock\.timers\.reset)$/;
const TEST_BLOCKS = new Set(["it", "test", "describe", "suite", "bench"]);
const SETUP_HOOKS = new Set(["beforeEach", "beforeAll"]);
const ALL_HOOKS = new Set([...SETUP_HOOKS, "afterEach", "afterAll"]);

interface TimerSwitch {
  pos: number;
  fake: boolean;
}

function calleeRoot(call: ts.CallExpression): string | undefined {
  let target: ts.Expression = call.expression;
  // it.each(rows)(...), test.skipIf(x)(...), describe.only(...)
  while (ts.isCallExpression(target) || ts.isPropertyAccessExpression(target)) {
    target = target.expression;
  }
  return ts.isIdentifier(target) ? target.text : undefined;
}

/**
 * Fake-timer switches in `node`, in source order, not counting those inside a
 * nested test block or hook: a sibling test's clock is not this test's clock.
 * `installers` names local helpers that switch fake timers on.
 */
function timerSwitches(
  node: ts.Node,
  installers: ReadonlySet<string>,
): TimerSwitch[] {
  const switches: TimerSwitch[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child)) {
      const root = calleeRoot(child);
      if (root && (TEST_BLOCKS.has(root) || ALL_HOOKS.has(root))) return;
      const chain = propertyChain(child.expression)?.join(".") ?? "";
      if (FAKE_TIMERS_ON.test(chain) || installers.has(chain)) {
        switches.push({ pos: child.getStart(), fake: true });
      } else if (FAKE_TIMERS_OFF.test(chain)) {
        switches.push({ pos: child.getStart(), fake: false });
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return switches;
}

/** Local functions that switch fake timers on: `function useClock() {...}`. */
function fakeTimerInstallers(sourceFile: ts.SourceFile): Set<string> {
  const installers = new Set<string>();
  const visit = (node: ts.Node) => {
    let name: string | undefined;
    let body: ts.Node | undefined;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      name = node.name.text;
      body = node.body;
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.text;
      body = node.initializer.body;
    }
    if (name && body && timerSwitches(body, installers).at(-1)?.fake) {
      installers.add(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return installers;
}

function setupHookFakesTimers(
  statement: ts.Statement,
  installers: ReadonlySet<string>,
): boolean {
  if (!ts.isExpressionStatement(statement)) return false;
  const call = unwrap(statement.expression);
  if (!ts.isCallExpression(call)) return false;
  const root = calleeRoot(call);
  if (!root || !SETUP_HOOKS.has(root)) return false;
  return call.arguments.some(
    (argument) =>
      (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) &&
      timerSwitches(argument.body, installers).at(-1)?.fake === true,
  );
}

/**
 * Whether fake timers are on when `assertion` runs: the nearest switch before
 * it in an enclosing function turned them on, or a `beforeEach`/`beforeAll`
 * of an enclosing block or the file did.
 */
function underFakeTimers(
  assertion: ts.Node,
  installers: ReadonlySet<string>,
): boolean {
  for (let node = assertion.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const before = timerSwitches(node.body, installers).filter(
        (entry) => entry.pos < assertion.getStart(),
      );
      const last = before.at(-1);
      if (last) return last.fake;
    }
    const statements = ts.isSourceFile(node)
      ? node.statements
      : ts.isBlock(node)
        ? node.statements
        : undefined;
    if (statements?.some((s) => setupHookFakesTimers(s, installers))) {
      return true;
    }
  }
  return false;
}

/**
 * The `expect(...)` argument a matcher call checks, when the matcher compares
 * values: `expect(x).toBeLessThan(1)`, `expect(x).not.toBe(1)`,
 * `expect.soft(x).toBe(1)`, `await expect(p).resolves.toBe(1)`.
 */
function expectedValue(call: ts.CallExpression): ts.Expression | undefined {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (!COMPARISON_MATCHERS.has(callee.name.text)) return undefined;
  let receiver = callee.expression;
  while (
    ts.isPropertyAccessExpression(receiver) &&
    MATCHER_MODIFIERS.has(receiver.name.text)
  ) {
    receiver = receiver.expression;
  }
  if (!ts.isCallExpression(receiver)) return undefined;
  const chain = propertyChain(receiver.expression)?.join(".");
  if (chain !== "expect" && chain !== "expect.soft") return undefined;
  return receiver.arguments[0];
}

function isAssertCall(call: ts.CallExpression): boolean {
  const chain = propertyChain(call.expression);
  return chain !== null && chain[0] === "assert" && chain.length <= 2;
}

function commentRanges(
  sourceFile: ts.SourceFile,
  source: string,
): ts.CommentRange[] {
  const ranges = new Map<number, ts.CommentRange>();
  // A comment on a token's own line is trailing trivia of the token before
  // it, one on a later line leading trivia of the token after, so visiting
  // both edges of every token reaches every comment.
  const visit = (node: ts.Node) => {
    for (const range of [
      ...(ts.getLeadingCommentRanges(source, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.end) ?? []),
    ]) {
      ranges.set(range.pos, range);
    }
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...ranges.values()];
}

/** Opt-out reasons by 1-based line. Only text inside a comment counts. */
function pragmaReasons(
  sourceFile: ts.SourceFile,
  source: string,
): Map<number, string[]> {
  const reasons = new Map<number, string[]>();
  const lineStarts = sourceFile.getLineStarts();
  for (const comment of commentRanges(sourceFile, source)) {
    const first = sourceFile.getLineAndCharacterOfPosition(comment.pos).line;
    const last = sourceFile.getLineAndCharacterOfPosition(comment.end).line;
    for (let line = first; line <= last; line += 1) {
      const from = Math.max(comment.pos, lineStarts[line] ?? comment.pos);
      const to = Math.min(comment.end, lineStarts[line + 1] ?? comment.end);
      const match = PRAGMA.exec(source.slice(from, to).replace(/\r?\n$/, ""));
      if (!match) continue;
      const reason = (match[1] ?? "").replace(/\*\/\s*$/, "").trim();
      reasons.set(line + 1, [...(reasons.get(line + 1) ?? []), reason]);
    }
  }
  return reasons;
}

/** Lines of the comment block that ends directly above `line` (1-based). */
function commentBlockAbove(lines: readonly string[], line: number): number[] {
  const block: number[] = [];
  for (let index = line - 2; index >= 0; index -= 1) {
    const text = (lines[index] ?? "").trim();
    if (!/^(?:\/\/|\/\*|\*)/.test(text) && !text.endsWith("*/")) break;
    block.push(index + 1);
  }
  return block;
}

/**
 * Wall-clock assertions in `source`. With `addedLines`, only assertions that
 * touch one of those lines; with null, every one (measurement mode).
 */
export function findWallClockAssertions(
  file: string,
  source: string,
  addedLines: ReadonlySet<number> | null,
): WallClockFinding[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const names = collectClockNames(sourceFile);
  let installers: Set<string> | undefined;
  const lines = source.split(/\r?\n/);
  let reasons: Map<number, string[]> | undefined;
  const findings: WallClockFinding[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const checked = expectedValue(node);
      const elapsed = checked
        ? isElapsedValue(checked, names)
        : isAssertCall(node) &&
          node.arguments.some((argument) => isElapsedValue(argument, names));
      if (elapsed) {
        const start =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
        const touched =
          addedLines === null ||
          [...addedLines].some((line) => line >= start && line <= end);
        installers ??= fakeTimerInstallers(sourceFile);
        if (touched && !underFakeTimers(node, installers)) {
          reasons ??= pragmaReasons(sourceFile, source);
          const candidates = [
            ...Array.from({ length: end - start + 1 }, (_, i) => start + i),
            ...commentBlockAbove(lines, start),
          ].flatMap((line) => reasons?.get(line) ?? []);
          const accepted = candidates.some(
            (reason) => reason.length >= MIN_REASON_LENGTH,
          );
          if (!accepted) {
            findings.push({
              file,
              line: start,
              snippet: node
                .getText(sourceFile)
                .replace(/\s+/g, " ")
                .slice(0, 120),
              ...(candidates.length > 0 ? { shortReason: true as const } : {}),
            });
          }
        }
        // The matcher call contains its own expect(); do not report it twice.
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function readSource(absPath: string, rel: string): string {
  try {
    return readFileSync(absPath, "utf8");
  } catch (error) {
    console.error(
      `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
}

function formatFinding(finding: WallClockFinding): string {
  const note = finding.shortReason
    ? `  (wall-clock-ok reason is shorter than ${MIN_REASON_LENGTH} characters)`
    : "";
  return `  ${finding.file}:${finding.line} - ${finding.snippet}${note}`;
}

function runDiffScoped(): void {
  const added = requireAddedLines(rootDir, GUARD_NAME);

  let inspected = 0;
  const findings: WallClockFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isTestFilePath(rel)) continue;
    inspected += 1;
    findings.push(
      ...findWallClockAssertions(rel, readSource(absPath, rel), lineNumbers),
    );
  }

  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${inspected} changed test file(s) inspected)`,
    );
    return;
  }

  console.error(
    `${GUARD_NAME}: ${findings.length} assertion(s) on elapsed wall-clock time added in tests.\n` +
      "A loaded CI runner stretches real time, so these fail correct runs.\n",
  );
  for (const finding of findings) console.error(formatFinding(finding));
  console.error(`\n${FIX_HINT}\n`);
  process.exit(1);
}

function runAll(): void {
  const listing = execGuardCommand("git", ["ls-files", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const files = listing.split("\0").filter((file) => isTestFilePath(file));
  if (files.length === 0) {
    console.error(`${GUARD_NAME} --all: git listed no test files.`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  const findings = files.flatMap((rel) =>
    findWallClockAssertions(
      rel,
      readSource(path.join(rootDir, rel), rel),
      null,
    ),
  );
  for (const finding of findings) console.log(formatFinding(finding));
  console.log(
    `\n${GUARD_NAME} --all (measurement only, not a CI mode): ` +
      `${findings.length} wall-clock assertion(s) in ` +
      `${new Set(findings.map((finding) => finding.file)).size} of ` +
      `${files.length} test file(s).`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--all");
  if (unknown.length > 0) {
    console.error(
      `${GUARD_NAME}: unknown option(s): ${unknown.join(", ")}\n` +
        "Usage: tsx scripts/guard-no-wall-clock-assertions.ts [--all]",
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
  if (args.includes("--all")) runAll();
  else runDiffScoped();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
