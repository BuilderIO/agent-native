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
 *     subtraction (`const elapsed = performance.now() - start`), arithmetic,
 *     a comparison or Math.round/floor/... on one of those, or what a local
 *     function returns (`timed(() => parse(input))`,
 *     `const { elapsed } = await measure()`).
 *
 * Names are resolved through TypeScript's binder, not matched as text: a
 * `start` declared in one test is not the `start` of another, and a local
 * variable named `performance` or `vi` is not the global or the import. A
 * variable the test advances itself (`clock += 20_000`) is a fake clock, not
 * a reading.
 *
 * An assertion counts as added when this branch added a line of it, or a line
 * that gives a variable it reads its clock or elapsed value: changing
 * `const elapsed = ...` can turn an unchanged assertion into a bound.
 *
 * An assertion that runs under fake timers is skipped: there `Date.now()` is
 * the test's own clock and an exact elapsed value is deterministic. The guard
 * replays the switches that run before the assertion - those in a
 * `beforeEach`/`beforeAll` of an enclosing describe block or the file, then
 * those before it in its enclosing functions, including calls to local
 * helpers - and skips the assertion only when every clock it reads is fake:
 *
 *   - `vi.useFakeTimers()` (and the jest and sinon spellings) fakes `Date`,
 *     `performance` and `hrtime`, or the clocks its `toFake` lists; with
 *     `shouldAdvanceTime` or options it cannot read it fakes none;
 *   - node:test's `mock.timers.enable()` fakes `Date` only, or what `apis`
 *     lists;
 *   - `vi.setSystemTime()` without fake timers mocks `Date` only;
 *   - `useRealTimers()` / `mock.timers.reset()` restores them all.
 *
 * A sibling test's fake clock, and a helper the test declares but never calls,
 * do not count.
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
 * in a comment on any line of the assertion, or in the comments directly
 * above it or above the statement it is part of.
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

/** A test file, parsed and bound so its names resolve to their declarations. */
interface TestFile {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
}

function bindTestFile(file: string, source: string): TestFile {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  // A program of this one file, with no lib and no imports followed: the
  // binder still resolves every local name, and a global or an import
  // resolves to no declaration in this file.
  const slashed = (name: string) => name.replace(/\\/g, "/");
  const isThisFile = (name: string) => slashed(name) === slashed(file);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (isThisFile(name) ? sourceFile : undefined),
    fileExists: isThisFile,
    readFile: () => undefined,
    writeFile: () => {},
    getDefaultLibFileName: () => "lib.d.ts",
    getCurrentDirectory: () => "",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram({
    rootNames: [file],
    options: { noLib: true, noResolve: true, allowJs: true, types: [] },
    host,
  });
  return { sourceFile, checker: program.getTypeChecker() };
}

function isImport(declaration: ts.Declaration): boolean {
  return (
    ts.isImportSpecifier(declaration) ||
    ts.isImportClause(declaration) ||
    ts.isNamespaceImport(declaration) ||
    ts.isImportEqualsDeclaration(declaration)
  );
}

/** The variable or function `identifier` names, when this file declares it. */
function localSymbol(
  file: TestFile,
  identifier: ts.Identifier,
): ts.Symbol | undefined {
  const symbol = file.checker.getSymbolAtLocation(identifier);
  if (!symbol?.declarations?.length || symbol.declarations.every(isImport)) {
    return undefined;
  }
  return file.checker.getExportSymbolOfSymbol(symbol);
}

/** An import's name in its module: `performance` for `{ performance as perf }`. */
function importedName(file: TestFile, identifier: ts.Identifier): string {
  const declaration =
    file.checker.getSymbolAtLocation(identifier)?.declarations?.[0];
  return declaration &&
    ts.isImportSpecifier(declaration) &&
    declaration.propertyName
    ? declaration.propertyName.text
    : identifier.text;
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

/** Property names from the root identifier, whatever the root resolves to. */
function propertyChain(node: ts.Expression): string[] | null {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return [target.text];
  if (ts.isPropertyAccessExpression(target)) {
    const head = propertyChain(target.expression);
    return head ? [...head, target.name.text] : null;
  }
  return null;
}

const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);

/**
 * `vi.useFakeTimers` as "vi.useFakeTimers" when its root is a global or an
 * import, never a local variable that shares the name. A global-object prefix
 * is dropped: `globalThis.performance.now` is "performance.now".
 */
function apiName(file: TestFile, node: ts.Expression): string | undefined {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) {
    return localSymbol(file, target) ? undefined : importedName(file, target);
  }
  if (!ts.isPropertyAccessExpression(target)) return undefined;
  const head = apiName(file, target.expression);
  if (head === undefined) return undefined;
  return GLOBAL_OBJECTS.has(head)
    ? target.name.text
    : `${head}.${target.name.text}`;
}

type ClockKind = "date" | "performance" | "hrtime";

const NO_CLOCKS: ReadonlySet<ClockKind> = new Set();
const ALL_CLOCKS: ReadonlySet<ClockKind> = new Set([
  "date",
  "performance",
  "hrtime",
]);
const DATE_CLOCK: ReadonlySet<ClockKind> = new Set(["date"]);

/** Date.now(), performance.now(), process.hrtime.bigint(), new Date().getTime(). */
function clockReadKind(
  file: TestFile,
  node: ts.Expression,
): ClockKind | undefined {
  const target = unwrap(node);
  if (!ts.isCallExpression(target)) return undefined;
  const callee = unwrap(target.expression);
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.name.text;
  const receiver = unwrap(callee.expression);
  if (method === "getTime" || method === "valueOf") {
    return ts.isNewExpression(receiver) &&
      apiName(file, receiver.expression) === "Date" &&
      (receiver.arguments?.length ?? 0) === 0
      ? "date"
      : undefined;
  }
  switch (apiName(file, callee)) {
    case "Date.now":
      return "date";
    case "performance.now":
      return "performance";
    case "process.hrtime.bigint":
      return "hrtime";
    default:
      return undefined;
  }
}

interface ClockBinding {
  /** The declaration or assignment, for its lines. */
  node: ts.Node;
  value: ts.Expression;
  /** For `const { elapsed } = measure()`, the property the binding reads. */
  property?: string;
}

interface ClockNames {
  /** Clocks a variable holds a reading of: `const startedAt = Date.now()`. */
  readings: Map<ts.Symbol, Set<ClockKind>>;
  /** Clocks an elapsed-time variable measures: `const elapsed = Date.now() - t0`. */
  elapsed: Map<ts.Symbol, Set<ClockKind>>;
  /** The bindings that give those variables a clock or elapsed value. */
  bindings: Map<ts.Symbol, ClockBinding[]>;
  /** Functions whose returns are being read, so recursion stops. */
  expanding: Set<ts.Node>;
}

/** What a value is, as far as clocks go. */
interface ClockValue {
  /** Clocks it is a reading of: `Date.now()`, `startedAt`. */
  reading: ReadonlySet<ClockKind>;
  /** Clocks it is an elapsed time on, or arithmetic or a comparison on one. */
  elapsed: ReadonlySet<ClockKind>;
}

const NOT_A_CLOCK: ClockValue = { reading: NO_CLOCKS, elapsed: NO_CLOCKS };

function unionClocks(
  sets: readonly ReadonlySet<ClockKind>[],
): ReadonlySet<ClockKind> {
  return new Set(sets.flatMap((set) => [...set]));
}

function unionValues(values: readonly ClockValue[]): ClockValue {
  return {
    reading: unionClocks(values.map((value) => value.reading)),
    elapsed: unionClocks(values.map((value) => value.elapsed)),
  };
}

function symbolValue(symbol: ts.Symbol, names: ClockNames): ClockValue {
  return {
    reading: names.readings.get(symbol) ?? NO_CLOCKS,
    elapsed: names.elapsed.get(symbol) ?? NO_CLOCKS,
  };
}

/** The local variable an identifier reads, including `{ elapsed }` shorthand. */
function referencedSymbol(
  file: TestFile,
  identifier: ts.Identifier,
): ts.Symbol | undefined {
  const parent = identifier.parent;
  if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) {
    const symbol = file.checker.getShorthandAssignmentValueSymbol(parent);
    return symbol?.declarations?.every(isImport) === false
      ? file.checker.getExportSymbolOfSymbol(symbol)
      : undefined;
  }
  return localSymbol(file, identifier);
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name)
    ? name.text
    : undefined;
}

/** The function this file declares under `symbol`: `function f() {}`, `const f = () => ...`. */
function localFunction(
  symbol: ts.Symbol,
): ts.FunctionLikeDeclaration | undefined {
  const declaration = symbol.valueDeclaration;
  if (!declaration) return undefined;
  if (ts.isFunctionDeclaration(declaration)) return declaration;
  const initializer = ts.isVariableDeclaration(declaration)
    ? declaration.initializer
    : undefined;
  return initializer &&
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ? initializer
    : undefined;
}

function calledFunction(
  file: TestFile,
  call: ts.CallExpression,
): ts.FunctionLikeDeclaration | undefined {
  const callee = unwrap(call.expression);
  const symbol = ts.isIdentifier(callee) && localSymbol(file, callee);
  return symbol ? localFunction(symbol) : undefined;
}

/** The expressions `fn` returns, not counting nested functions' returns. */
function returnedExpressions(fn: ts.FunctionLikeDeclaration): ts.Expression[] {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const returned: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      returned.push(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body, visit);
  return returned;
}

/**
 * What a call to a local function returns, or the `property` of it when the
 * caller destructures one: `const { elapsed } = await measure()`.
 */
function returnedValue(
  file: TestFile,
  call: ts.CallExpression,
  property: string | undefined,
  names: ClockNames,
): ClockValue {
  const fn = calledFunction(file, call);
  if (!fn || names.expanding.has(fn)) return NOT_A_CLOCK;
  names.expanding.add(fn);
  try {
    return unionValues(
      returnedExpressions(fn).map((returned) =>
        property === undefined
          ? clockValue(file, returned, names)
          : propertyValue(file, returned, property, names),
      ),
    );
  } finally {
    names.expanding.delete(fn);
  }
}

/** The value of `property` of an object literal or of a local call's result. */
function propertyValue(
  file: TestFile,
  node: ts.Expression,
  property: string,
  names: ClockNames,
): ClockValue {
  const target = unwrap(node);
  if (ts.isCallExpression(target)) {
    return returnedValue(file, target, property, names);
  }
  if (!ts.isObjectLiteralExpression(target)) return NOT_A_CLOCK;
  return unionValues(
    target.properties.map((member) => {
      if (!member.name || propertyNameText(member.name) !== property) {
        return NOT_A_CLOCK;
      }
      if (ts.isPropertyAssignment(member)) {
        return clockValue(file, member.initializer, names);
      }
      const symbol =
        ts.isShorthandPropertyAssignment(member) &&
        referencedSymbol(file, member.name);
      return symbol ? symbolValue(symbol, names) : NOT_A_CLOCK;
    }),
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
const ADVANCING_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);
const NUMERIC_WRAPPERS = new Set([
  "Math.round",
  "Math.floor",
  "Math.ceil",
  "Math.trunc",
  "Math.abs",
  "Math.min",
  "Math.max",
  "Number",
]);

/**
 * What the value of `node` is, as far as clocks go. It is an elapsed time on
 * a clock when it subtracts a reading of it (`Date.now() - t0`), or is
 * arithmetic, a comparison or Math.round/... on an elapsed time
 * (`elapsed / 1000`, `elapsed < 50`), or is what a local function returns
 * (`measure()`). Only the value itself counts, so an object or call that
 * merely holds such an expression somewhere inside it
 * (`run({ since: Date.now() - 1_000 })`) is not elapsed time.
 */
function clockValue(
  file: TestFile,
  node: ts.Expression,
  names: ClockNames,
): ClockValue {
  const target = unwrap(node);
  const kind = clockReadKind(file, target);
  if (kind) return { reading: new Set([kind]), elapsed: NO_CLOCKS };
  if (ts.isIdentifier(target)) {
    const symbol = localSymbol(file, target);
    return symbol ? symbolValue(symbol, names) : NOT_A_CLOCK;
  }
  if (ts.isBinaryExpression(target)) {
    const operator = target.operatorToken.kind;
    if (!DERIVING_OPERATORS.has(operator)) return NOT_A_CLOCK;
    const left = clockValue(file, target.left, names);
    const right = clockValue(file, target.right, names);
    return {
      reading: NO_CLOCKS,
      elapsed: unionClocks(
        operator === ts.SyntaxKind.MinusToken
          ? [left.elapsed, right.elapsed, left.reading, right.reading]
          : [left.elapsed, right.elapsed],
      ),
    };
  }
  if (ts.isPrefixUnaryExpression(target)) {
    return {
      reading: NO_CLOCKS,
      elapsed: clockValue(file, target.operand, names).elapsed,
    };
  }
  if (ts.isCallExpression(target)) {
    const callee = apiName(file, target.expression);
    return callee && NUMERIC_WRAPPERS.has(callee)
      ? unionValues(
          target.arguments.map((argument) => clockValue(file, argument, names)),
        )
      : returnedValue(file, target, undefined, names);
  }
  return NOT_A_CLOCK;
}

function bindingValue(
  file: TestFile,
  binding: ClockBinding,
  names: ClockNames,
): ClockValue {
  return binding.property === undefined
    ? clockValue(file, binding.value, names)
    : propertyValue(file, binding.value, binding.property, names);
}

function isClock(value: ClockValue): boolean {
  return value.reading.size > 0 || value.elapsed.size > 0;
}

function collectClockNames(file: TestFile): ClockNames {
  const names: ClockNames = {
    readings: new Map(),
    elapsed: new Map(),
    bindings: new Map(),
    expanding: new Set(),
  };
  const bindings: [symbol: ts.Symbol, binding: ClockBinding][] = [];
  // A variable the test moves itself (`clock += 20_000`) is a fake clock it
  // controls, not a reading of real time, whatever it started from.
  const advanced = new Set<ts.Symbol>();
  const bind = (name: ts.Node, binding: ClockBinding) => {
    const symbol = ts.isIdentifier(name) && localSymbol(file, name);
    if (symbol) bindings.push([symbol, binding]);
  };
  const advance = (target: ts.Expression) => {
    const symbol = ts.isIdentifier(target) && localSymbol(file, target);
    if (symbol) advanced.add(symbol);
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      ADVANCING_OPERATORS.has(node.operatorToken.kind)
    ) {
      advance(node.left);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      ADVANCING_OPERATORS.has(node.operator)
    ) {
      advance(node.operand);
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const value = node.initializer;
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const property = element.propertyName
            ? propertyNameText(element.propertyName)
            : ts.isIdentifier(element.name)
              ? element.name.text
              : undefined;
          if (property !== undefined && !element.dotDotDotToken) {
            bind(element.name, { node, value, property });
          }
        }
      } else {
        bind(node.name, { node, value });
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      bind(node.left, { node, value: node.right });
    }
    ts.forEachChild(node, visit);
  };
  visit(file.sourceFile);

  // An elapsed variable can be derived from another one, so iterate until
  // nothing new is learned.
  const learn = (
    map: Map<ts.Symbol, Set<ClockKind>>,
    symbol: ts.Symbol,
    kinds: ReadonlySet<ClockKind>,
  ) => {
    let learned = false;
    for (const kind of kinds) {
      const held = map.get(symbol) ?? new Set<ClockKind>();
      if (held.has(kind)) continue;
      held.add(kind);
      map.set(symbol, held);
      learned = true;
    }
    return learned;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const [symbol, binding] of bindings) {
      const value = bindingValue(file, binding, names);
      const learnedReading =
        !advanced.has(symbol) && learn(names.readings, symbol, value.reading);
      const learnedElapsed = learn(names.elapsed, symbol, value.elapsed);
      changed ||= learnedReading || learnedElapsed;
    }
  }
  for (const [symbol, binding] of bindings) {
    if (!isClock(bindingValue(file, binding, names))) continue;
    names.bindings.set(symbol, [
      ...(names.bindings.get(symbol) ?? []),
      binding,
    ]);
  }
  return names;
}

/**
 * Line ranges (1-based) of the code that gives `values` their clock or
 * elapsed value: the bindings of the variables they read and the returns of
 * the local functions they call, followed through what those read in turn.
 */
function bindingLines(
  file: TestFile,
  values: readonly ts.Expression[],
  names: ClockNames,
): [from: number, to: number][] {
  const { sourceFile } = file;
  const rangeOf = (node: ts.Node): [number, number] => [
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1,
    sourceFile.getLineAndCharacterOfPosition(node.end).line + 1,
  ];
  const ranges: [number, number][] = [];
  const followed = new Set<ts.Symbol | ts.Node>();
  const visit = (node: ts.Node) => {
    const fn = ts.isCallExpression(node) && calledFunction(file, node);
    if (fn && !followed.has(fn)) {
      followed.add(fn);
      for (const returned of returnedExpressions(fn)) {
        ranges.push(rangeOf(returned));
        visit(returned);
      }
    }
    const symbol = ts.isIdentifier(node) && referencedSymbol(file, node);
    if (symbol && !followed.has(symbol)) {
      followed.add(symbol);
      for (const binding of names.bindings.get(symbol) ?? []) {
        ranges.push(rangeOf(binding.node));
        visit(binding.value);
      }
    }
    ts.forEachChild(node, visit);
  };
  values.forEach(visit);
  return ranges;
}

/** What fake timers replace at a point in a test. */
interface FakeState {
  /** Whether a fake clock is installed, which `setSystemTime` then moves. */
  installed: boolean;
  clocks: ReadonlySet<ClockKind>;
}

const REAL_TIMERS: FakeState = { installed: false, clocks: NO_CLOCKS };

type TimerEffect =
  | { op: "install"; clocks: ReadonlySet<ClockKind> }
  | { op: "setSystemTime" }
  | { op: "restore" };

interface TimerSwitch {
  pos: number;
  effect: TimerEffect;
}

function applyEffect(state: FakeState, effect: TimerEffect): FakeState {
  switch (effect.op) {
    case "install":
      return { installed: true, clocks: effect.clocks };
    case "restore":
      return REAL_TIMERS;
    case "setSystemTime":
      // With a fake clock installed it moves that clock and fakes nothing
      // new; without one it mocks Date alone.
      return state.installed
        ? state
        : {
            installed: false,
            clocks: unionClocks([state.clocks, DATE_CLOCK]),
          };
  }
}

function replay(switches: readonly TimerSwitch[]): FakeState {
  return switches.reduce(
    (state, entry) => applyEffect(state, entry.effect),
    REAL_TIMERS,
  );
}

const CLOCK_TIMER_NAMES = new Map<string, ClockKind>([
  ["Date", "date"],
  ["performance", "performance"],
  ["hrtime", "hrtime"],
]);
const CLOCK_OPTION_KEYS = new Set([
  "toFake",
  "doNotFake",
  "apis",
  "shouldAdvanceTime",
  "advanceTimers",
]);

/** Clocks named in `["Date", "setTimeout"]`, or undefined when unreadable. */
function listedClocks(node: ts.Expression): Set<ClockKind> | undefined {
  const target = unwrap(node);
  if (!ts.isArrayLiteralExpression(target)) return undefined;
  const clocks = new Set<ClockKind>();
  for (const element of target.elements) {
    if (!ts.isStringLiteralLike(element)) return undefined;
    const kind = CLOCK_TIMER_NAMES.get(element.text);
    if (kind) clocks.add(kind);
  }
  return clocks;
}

/**
 * The clocks a fake-timer install fakes, read from its options (`toFake`,
 * jest's `doNotFake`, node:test's `apis`). Fake time that advances with real
 * time, and options this cannot read, fake nothing, so the assertion is still
 * checked.
 */
function installedClocks(
  options: ts.Expression | undefined,
  defaults: ReadonlySet<ClockKind>,
): ReadonlySet<ClockKind> {
  if (!options) return defaults;
  const target = unwrap(options);
  // sinon.useFakeTimers(now)
  if (ts.isNumericLiteral(target) || ts.isNewExpression(target)) {
    return defaults;
  }
  // mock.timers.enable(["Date"]), node:test's signature before options.
  if (ts.isArrayLiteralExpression(target)) {
    return listedClocks(target) ?? NO_CLOCKS;
  }
  if (!ts.isObjectLiteralExpression(target)) return NO_CLOCKS;
  let clocks: ReadonlySet<ClockKind> = defaults;
  let excluded: ReadonlySet<ClockKind> = NO_CLOCKS;
  for (const property of target.properties) {
    if (ts.isSpreadAssignment(property)) return NO_CLOCKS;
    const key = property.name && propertyNameText(property.name);
    if (key === undefined || !CLOCK_OPTION_KEYS.has(key)) continue;
    if (!ts.isPropertyAssignment(property)) return NO_CLOCKS;
    const value = unwrap(property.initializer);
    if (key === "shouldAdvanceTime" || key === "advanceTimers") {
      if (value.kind !== ts.SyntaxKind.FalseKeyword) return NO_CLOCKS;
      continue;
    }
    const listed = listedClocks(value);
    if (!listed) return NO_CLOCKS;
    if (key === "doNotFake") excluded = listed;
    else clocks = listed;
  }
  return new Set([...clocks].filter((kind) => !excluded.has(kind)));
}

/** The timer switch `call` makes, when it makes one. */
function timerEffect(
  file: TestFile,
  call: ts.CallExpression,
  helpers: ReadonlyMap<ts.Symbol, TimerEffect>,
): TimerEffect | undefined {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) {
    const symbol = localSymbol(file, callee);
    if (symbol) return helpers.get(symbol);
  }
  const options = call.arguments[0];
  switch (apiName(file, callee)) {
    case "vi.useFakeTimers":
    case "jest.useFakeTimers":
    case "sinon.useFakeTimers":
      return { op: "install", clocks: installedClocks(options, ALL_CLOCKS) };
    case "vi.setSystemTime":
    case "jest.setSystemTime":
      return { op: "setSystemTime" };
    case "vi.useRealTimers":
    case "jest.useRealTimers":
      return { op: "restore" };
  }
  // node:test mocks on the imported `mock` and on a test context's `t.mock`.
  switch (propertyChain(callee)?.slice(-3).join(".")) {
    case "mock.timers.enable":
      return { op: "install", clocks: installedClocks(options, DATE_CLOCK) };
    case "mock.timers.reset":
      return { op: "restore" };
    default:
      return undefined;
  }
}

/**
 * Timer switches `node` makes as it runs, in source order. A nested function
 * (a sibling test, a hook, a helper) switches nothing until it is called, and
 * a call counts for the local functions in `helpers`.
 */
function timerSwitches(
  file: TestFile,
  node: ts.Node,
  helpers: ReadonlyMap<ts.Symbol, TimerEffect>,
): TimerSwitch[] {
  const switches: TimerSwitch[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isFunctionLike(child)) return;
    if (ts.isCallExpression(child)) {
      const effect = timerEffect(file, child, helpers);
      if (effect) switches.push({ pos: child.getStart(), effect });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return switches;
}

/** Local functions that switch timers, by what calling one does: `function useClock() {...}`. */
function timerHelpers(file: TestFile): Map<ts.Symbol, TimerEffect> {
  const helpers = new Map<ts.Symbol, TimerEffect>();
  const visit = (node: ts.Node) => {
    let name: ts.Node | undefined;
    let body: ts.Node | undefined;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      name = node.name;
      body = node.body;
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name;
      body = node.initializer.body;
    }
    const symbol = name && ts.isIdentifier(name) && localSymbol(file, name);
    if (symbol && body) {
      const switches = timerSwitches(file, body, helpers);
      if (switches.length > 0) {
        const state = replay(switches);
        helpers.set(
          symbol,
          state.installed
            ? { op: "install", clocks: state.clocks }
            : state.clocks.size > 0
              ? { op: "setSystemTime" }
              : { op: "restore" },
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file.sourceFile);
  return helpers;
}

const SETUP_HOOKS = new Set(["beforeEach", "beforeAll"]);

/** The switches a `beforeEach`/`beforeAll` statement makes before each test. */
function setupHookSwitches(
  file: TestFile,
  statement: ts.Statement,
  helpers: ReadonlyMap<ts.Symbol, TimerEffect>,
): TimerSwitch[] {
  if (!ts.isExpressionStatement(statement)) return [];
  const call = unwrap(statement.expression);
  if (!ts.isCallExpression(call)) return [];
  const hook = apiName(file, call.expression);
  if (!hook || !SETUP_HOOKS.has(hook)) return [];
  return call.arguments.flatMap((argument): TimerSwitch[] => {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      return timerSwitches(file, argument.body, helpers);
    }
    const symbol = ts.isIdentifier(argument) && localSymbol(file, argument);
    const effect = symbol && helpers.get(symbol);
    return effect ? [{ pos: argument.getStart(), effect }] : [];
  });
}

/**
 * What fake timers replace when `assertion` runs: the switches made by the
 * `beforeEach`/`beforeAll` hooks of enclosing blocks and the file, outermost
 * first, then those before it in its enclosing functions.
 */
function fakeStateAt(
  file: TestFile,
  assertion: ts.Node,
  helpers: ReadonlyMap<ts.Symbol, TimerEffect>,
): FakeState {
  const start = assertion.getStart();
  const hooks: TimerSwitch[][] = [];
  const inline: TimerSwitch[] = [];
  for (let node = assertion.parent; node; node = node.parent) {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      inline.push(
        ...timerSwitches(file, node.body, helpers).filter(
          (entry) => entry.pos < start,
        ),
      );
    }
    if (ts.isSourceFile(node) || ts.isBlock(node)) {
      hooks.unshift(
        node.statements.flatMap((statement) =>
          setupHookSwitches(file, statement, helpers),
        ),
      );
    }
  }
  return replay([...hooks.flat(), ...inline.sort((a, b) => a.pos - b.pos)]);
}

/**
 * The `expect(...)` argument a matcher call checks, when the matcher compares
 * values: `expect(x).toBeLessThan(1)`, `expect(x).not.toBe(1)`,
 * `expect.soft(x).toBe(1)`, `await expect(p).resolves.toBe(1)`.
 */
function expectedValue(
  file: TestFile,
  call: ts.CallExpression,
): ts.Expression | undefined {
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
  const name = apiName(file, receiver.expression);
  if (name !== "expect" && name !== "expect.soft") return undefined;
  return receiver.arguments[0];
}

function isAssertCall(file: TestFile, call: ts.CallExpression): boolean {
  const name = apiName(file, call.expression)?.split(".");
  return name?.[0] === "assert" && name.length <= 2;
}

function commentRanges(sourceFile: ts.SourceFile): ts.CommentRange[] {
  const source = sourceFile.text;
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

/** The statement, in a block or the file, that `node` is part of. */
function enclosingStatement(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    !ts.isBlock(current.parent) &&
    !ts.isSourceFile(current.parent) &&
    !ts.isCaseOrDefaultClause(current.parent)
  ) {
    current = current.parent;
  }
  return current;
}

/**
 * The comments directly above `node`: its leading comments back to the first
 * blank line. A comment after code on the line above belongs to that code.
 */
function commentsAbove(source: string, node: ts.Node): ts.CommentRange[] {
  const leading = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  const above: ts.CommentRange[] = [];
  let next = node.getStart();
  for (const comment of leading.toReversed()) {
    if (source.slice(comment.end, next).split("\n").length > 2) break;
    above.push(comment);
    next = comment.pos;
  }
  return above;
}

/**
 * Opt-out reasons for `assertion`: from comments that start on one of its
 * lines, and from those directly above it or above its statement.
 */
function optOutReasons(
  sourceFile: ts.SourceFile,
  assertion: ts.Node,
  comments: readonly ts.CommentRange[],
): string[] {
  const source = sourceFile.text;
  const lineStarts = sourceFile.getLineStarts();
  const firstLine = sourceFile.getLineAndCharacterOfPosition(
    assertion.getStart(sourceFile),
  ).line;
  const lastLine = sourceFile.getLineAndCharacterOfPosition(assertion.end).line;
  const from = lineStarts[firstLine] ?? 0;
  const to = lineStarts[lastLine + 1] ?? source.length;
  const candidates = new Map<number, ts.CommentRange>();
  for (const comment of [
    ...comments.filter((range) => range.pos >= from && range.pos < to),
    ...commentsAbove(source, assertion),
    ...commentsAbove(source, enclosingStatement(assertion)),
  ]) {
    candidates.set(comment.pos, comment);
  }
  return [...candidates.values()].flatMap((comment) =>
    source
      .slice(comment.pos, comment.end)
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = PRAGMA.exec(line);
        return match ? [(match[1] ?? "").replace(/\*\/\s*$/, "").trim()] : [];
      }),
  );
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
  const testFile = bindTestFile(file, source);
  const { sourceFile } = testFile;
  const names = collectClockNames(testFile);
  let helpers: Map<ts.Symbol, TimerEffect> | undefined;
  let comments: ts.CommentRange[] | undefined;
  const findings: WallClockFinding[] = [];
  const lineOf = (pos: number) =>
    sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const checked = expectedValue(testFile, node);
      const values = checked
        ? [checked]
        : isAssertCall(testFile, node)
          ? [...node.arguments]
          : [];
      const clocks = unionClocks(
        values.map((value) => clockValue(testFile, value, names).elapsed),
      );
      if (clocks.size > 0) {
        const start = lineOf(node.getStart(sourceFile));
        const end = lineOf(node.end);
        const touched =
          addedLines === null ||
          [
            [start, end] as const,
            ...bindingLines(testFile, values, names),
          ].some(([from, to]) =>
            [...addedLines].some((line) => line >= from && line <= to),
          );
        helpers ??= timerHelpers(testFile);
        const faked = fakeStateAt(testFile, node, helpers).clocks;
        const underFakeTimers = [...clocks].every((kind) => faked.has(kind));
        if (touched && !underFakeTimers) {
          comments ??= commentRanges(sourceFile);
          const reasons = optOutReasons(sourceFile, node, comments);
          const accepted = reasons.some(
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
              ...(reasons.length > 0 ? { shortReason: true as const } : {}),
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
