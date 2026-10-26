/**
 * guard-no-deferred-server-counts.ts
 *
 * Server code counts and tracks inside the request. A serverless instance can
 * freeze once the response is sent, so a count scheduled with `setTimeout`,
 * `setInterval`, `setImmediate` or `queueMicrotask` may run only when the
 * instance next thaws, or never. Content's save-outcome and editor-mount counters both
 * deferred their count this way.
 *
 * `countOutcome` bumps an in-memory window and, for the first hit in a window,
 * hands one event to each analytics provider's `track()`, which the built-in
 * providers only queue; nothing waits for delivery. So call it in the request
 * and keep it from changing the response:
 *
 *   try {
 *     countOutcome("<thing>_counts", dimensions);
 *   } catch {
 *     // coercion-ok: a count cannot change the response.
 *   }
 *
 * The guard scans every server source file (actions and server directories
 * of templates, community templates, apps and packages) for a timer callback
 * that calls `track`, a `track…` wrapper such as `trackLifecycleEvent`, or a
 * count helper. TypeScript resolves each name in that one file the way its
 * scope sees it, so the guard follows callbacks passed by name or as methods
 * (`this.flush`, `queue.flush`), the functions and methods they call, names
 * bound by destructuring, and timers renamed through any chain of aliases or
 * imports (`const defer = setTimeout`, `import { setTimeout as defer }`). A
 * function the file shows is judged by its body, whatever it's called, and so
 * is a function another scanned server file exports, when it's imported by a
 * relative path: `recordContentSaveOutcome` counts because its own file shows
 * it calling `countOutcome`, and so does a wrapper of it. A name whose function
 * the guard can't see (a package import, a global, a parameter, a factory's
 * result) is judged by its name. A function a callback only defines
 * or passes along counts where it runs: where a call to it is followed, or
 * when it's handed to a call that runs it (a function in the file that calls
 * that parameter, or else an array iteration or promise method, a promise
 * executor, or `Array.from`'s mapper). A call that may only keep the function,
 * such as `register(flush)`, `cache.set(key, flush)` or a helper from another
 * file, isn't taken to run it. A timer that has to defer a count says why, on
 * any line of the timer call or the line above:
 *
 *   // guard:allow-deferred-count — <why the count can wait>
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { GUARD_EXIT_COULD_NOT_RUN } from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-deferred-server-counts";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-deferred-count\b/;
const IN_SCOPE =
  /^(?:(?:templates|community-templates|apps)\/[^/]+\/(?:actions|server)\/|packages\/[^/]+\/src\/(?:.+\/)?(?:actions|server)\/)/;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TIMERS = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
]);
const TIMER_WORD = /setTimeout|setInterval|setImmediate|queueMicrotask/;
/**
 * Methods that run the functions at these argument positions before they
 * settle, unless the file defines a method of that name itself.
 */
const RUNS_CALLBACKS = new Map<string, readonly number[]>([
  ["every", [0]],
  ["filter", [0]],
  ["find", [0]],
  ["findIndex", [0]],
  ["findLast", [0]],
  ["findLastIndex", [0]],
  ["flatMap", [0]],
  ["forEach", [0]],
  ["map", [0]],
  ["reduce", [0]],
  ["reduceRight", [0]],
  ["some", [0]],
  ["sort", [0]],
  ["toSorted", [0]],
  ["then", [0, 1]],
  ["catch", [0]],
  ["finally", [0]],
]);
const COUNTS = new Set([
  "countOutcome",
  "countActionFailure",
  "countAttachmentOutcome",
  "countCredentialState",
]);

export interface DeferredCountFinding {
  file: string;
  line: number;
  snippet: string;
}

export function isServerSourcePath(relPath: string): boolean {
  return (
    !SKIPPED.test(relPath) &&
    SOURCE_FILE.test(relPath) &&
    IN_SCOPE.test(relPath)
  );
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

/** `track`, its wrappers such as `trackEvent`, and the count helpers. */
function isCountName(name: string): boolean {
  return COUNTS.has(name) || /^track(?:[A-Z]\w*)?$/.test(name);
}

/**
 * The exports of scanned server files that count when called, by the file's
 * repo-relative path.
 */
export type CountingExports = ReadonlyMap<string, ReadonlySet<string>>;

const NO_EXPORTS: ReadonlySet<string> = new Set();

/** What a file's names resolve to. */
interface FileScope {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  /** The counting exports of the module a specifier names. */
  exportsOf: (specifier: string) => ReadonlySet<string>;
}

/** The paths a relative import could name, as `.js` names a `.ts` file. */
export function importCandidates(
  fromFile: string,
  specifier: string,
): string[] {
  if (!specifier.startsWith(".")) return [];
  const joined = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), specifier),
  );
  const stem = joined.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/, "");
  return [
    joined,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"].map((ext) => stem + ext),
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
  ];
}

function parse(file: string, source: string): ts.SourceFile {
  const tsx = /\.[cm]?[jt]sx$/.test(file);
  return ts.createSourceFile(
    tsx ? "/guarded.tsx" : "/guarded.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * A file's scope, reading other files' exports from `known` as it grows.
 * `scopes` keeps each file's checker for the next pass over it; every scope in
 * it must have been made with the same `known`.
 */
function fileScope(
  file: string,
  source: string,
  known: CountingExports,
  scopes?: Map<string, FileScope>,
): FileScope {
  const cached = scopes?.get(file);
  if (cached) return cached;
  const sourceFile = parse(file, source);
  const scope: FileScope = {
    sourceFile,
    checker: fileChecker(sourceFile),
    exportsOf: (specifier) => {
      for (const candidate of importCandidates(file, specifier)) {
        const names = known.get(candidate);
        if (names) return names;
      }
      return NO_EXPORTS;
    },
  };
  scopes?.set(file, scope);
  return scope;
}

/**
 * A type checker over this one file, so a name resolves to the declaration its
 * scope sees, and `this.flush` or `queue.flush` to the method. Imports stay
 * unresolved; `FileScope.exportsOf` answers for other scanned files.
 */
function fileChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
  const host: ts.CompilerHost = {
    getSourceFile: (name) =>
      name === sourceFile.fileName ? sourceFile : undefined,
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (name) => name === sourceFile.fileName,
    readFile: () => undefined,
  };
  return ts
    .createProgram({
      rootNames: [sourceFile.fileName],
      options: { noLib: true, noResolve: true, strict: true, types: [] },
      host,
    })
    .getTypeChecker();
}

function bodyOf(node: ts.Node): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  ) {
    return node.body;
  }
  return undefined;
}

function symbolDeclaration(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.Declaration | undefined {
  const declaration =
    symbol?.declarations?.find((candidate) => bodyOf(candidate)) ??
    symbol?.valueDeclaration ??
    symbol?.declarations?.[0];
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    return symbolDeclaration(
      checker,
      checker.getShorthandAssignmentValueSymbol(declaration),
    );
  }
  return declaration;
}

/** The declaration a name or property reference resolves to in this file. */
function declarationOf(
  checker: ts.TypeChecker,
  reference: ts.Identifier | ts.PropertyAccessExpression,
): ts.Declaration | undefined {
  return symbolDeclaration(
    checker,
    checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(reference) ? reference.name : reference,
    ),
  );
}

/**
 * The name a declaration takes from elsewhere: `setTimeout` in
 * `import { setTimeout as defer }` or `const { setTimeout: later } = globalThis`.
 */
function sourceName(declaration: ts.Declaration): string | undefined {
  if (ts.isImportSpecifier(declaration)) {
    return (declaration.propertyName ?? declaration.name).text;
  }
  if (
    ts.isBindingElement(declaration) &&
    ts.isObjectBindingPattern(declaration.parent)
  ) {
    const name = declaration.propertyName ?? declaration.name;
    return ts.isIdentifier(name) || ts.isStringLiteral(name)
      ? name.text
      : undefined;
  }
  return undefined;
}

/** What a declaration binds: a function, another expression, or nothing. */
function boundValue(
  checker: ts.TypeChecker,
  declaration: ts.Declaration,
): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(declaration) ||
    ts.isMethodDeclaration(declaration)
  ) {
    return declaration;
  }
  if (
    ts.isVariableDeclaration(declaration) ||
    ts.isPropertyAssignment(declaration) ||
    ts.isPropertyDeclaration(declaration)
  ) {
    return declaration.initializer;
  }
  // `const { flush } = queue` binds `queue.flush`.
  if (ts.isBindingElement(declaration)) {
    const name = sourceName(declaration);
    const property =
      name &&
      symbolDeclaration(
        checker,
        checker.getTypeAtLocation(declaration.parent).getProperty(name),
      );
    return property && !ts.isBindingElement(property)
      ? boundValue(checker, property)
      : undefined;
  }
  return undefined;
}

/** `(flush)`, `flush as Fn` and `flush!` all name `flush`. */
function unwrapped(expression: ts.Expression): ts.Expression {
  let target = expression;
  while (
    ts.isParenthesizedExpression(target) ||
    ts.isAsExpression(target) ||
    ts.isSatisfiesExpression(target) ||
    ts.isNonNullExpression(target)
  ) {
    target = target.expression;
  }
  return target;
}

/** `flush.bind(this)` runs `flush`. */
function unbound(expression: ts.Expression): ts.Expression {
  let target = unwrapped(expression);
  while (
    ts.isCallExpression(target) &&
    ts.isPropertyAccessExpression(target.expression) &&
    target.expression.name.text === "bind"
  ) {
    target = unwrapped(target.expression.expression);
  }
  return target;
}

/** A timer, or a name bound to one through any chain of aliases. */
function isTimerReference(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen: Set<ts.Node>,
): boolean {
  const target = unbound(expression);
  const name = calleeName(target);
  if (name && TIMERS.has(name)) return true;
  if (!ts.isIdentifier(target) && !ts.isPropertyAccessExpression(target)) {
    return false;
  }
  const declaration = declarationOf(checker, target);
  if (!declaration || seen.has(declaration)) return false;
  seen.add(declaration);
  const source = sourceName(declaration);
  if (source && TIMERS.has(source)) return true;
  const value = boundValue(checker, declaration);
  return (
    !!value && ts.isExpression(value) && isTimerReference(checker, value, seen)
  );
}

/** `flush.call(this)` and `flush.apply(this, args)` run `flush`. */
function invoked(expression: ts.Expression): ts.Expression {
  const target = unbound(expression);
  return ts.isPropertyAccessExpression(target) &&
    (target.name.text === "call" || target.name.text === "apply")
    ? unbound(target.expression)
    : target;
}

/**
 * The module and export a reference imports, as in `import { record } from
 * "./outcomes.js"` or `outcomes.record` from `import * as outcomes`.
 */
function importedExport(
  checker: ts.TypeChecker,
  target: ts.Identifier | ts.PropertyAccessExpression,
  declaration: ts.Declaration | undefined,
): { specifier: string; name: string } | undefined {
  if (declaration && ts.isImportSpecifier(declaration)) {
    const module = declaration.parent.parent.parent.moduleSpecifier;
    return ts.isStringLiteral(module)
      ? {
          specifier: module.text,
          name: (declaration.propertyName ?? declaration.name).text,
        }
      : undefined;
  }
  if (
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(target.expression)
  ) {
    const namespace = declarationOf(checker, target.expression);
    if (namespace && ts.isNamespaceImport(namespace)) {
      const module = namespace.parent.parent.moduleSpecifier;
      return ts.isStringLiteral(module)
        ? { specifier: module.text, name: target.name.text }
        : undefined;
    }
  }
  return undefined;
}

/**
 * Whether calling this reference tracks or counts. A function the file shows,
 * through any aliases, is judged by its body, so a local `trackRetry` that
 * only retries isn't a count; so is one another scanned server file exports.
 * Otherwise the names it goes by decide: `import { countOutcome as record }`,
 * `const { trackEvent } = analytics`, a `trackSave` a factory returns.
 */
function countsWhenCalled(
  scope: FileScope,
  expression: ts.Expression,
  seen: Set<ts.Node>,
): boolean {
  const { checker } = scope;
  const names: string[] = [];
  let target = invoked(expression);
  for (;;) {
    const body = bodyOf(target);
    if (body) return callsCount(scope, body, seen);
    if (!ts.isIdentifier(target) && !ts.isPropertyAccessExpression(target)) {
      break;
    }
    names.push(calleeName(target) ?? "");
    const declaration = declarationOf(checker, target);
    const imported = importedExport(checker, target, declaration);
    if (imported && scope.exportsOf(imported.specifier).has(imported.name)) {
      return true;
    }
    if (!declaration) break;
    if (seen.has(declaration)) return false;
    seen.add(declaration);
    names.push(sourceName(declaration) ?? "");
    const value = boundValue(checker, declaration);
    const valueBody = value && bodyOf(value);
    if (valueBody) return callsCount(scope, valueBody, seen);
    if (!value || !ts.isExpression(value)) break;
    target = invoked(value);
  }
  return names.some((name) => name && isCountName(name));
}

/** The function this file binds to a reference, through any aliases. */
function resolvedFunction(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen: Set<ts.Node>,
): ts.FunctionLikeDeclaration | undefined {
  const target = unbound(expression);
  if (bodyOf(target)) return target as ts.FunctionLikeDeclaration;
  if (!ts.isIdentifier(target) && !ts.isPropertyAccessExpression(target)) {
    return undefined;
  }
  const declaration = declarationOf(checker, target);
  if (!declaration || seen.has(declaration)) return undefined;
  seen.add(declaration);
  const value = boundValue(checker, declaration);
  if (!value) return undefined;
  if (bodyOf(value)) return value as ts.FunctionLikeDeclaration;
  return ts.isExpression(value)
    ? resolvedFunction(checker, value, seen)
    : undefined;
}

/**
 * Whether a call runs the function it's handed at `index`. A function the file
 * shows answers by whether it calls that parameter, so a local `map` that only
 * stores it doesn't run it. Otherwise only an array iteration or promise
 * method, a promise executor, `Array.from`'s mapper or `Promise.try` does; any
 * other call may only keep the function.
 */
function runsArgument(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
  index: number,
  seen: Set<ts.Node>,
): boolean {
  const callee = unwrapped(call.expression);
  const fn = ts.isCallExpression(call)
    ? resolvedFunction(checker, callee, seen)
    : undefined;
  if (fn?.body) {
    const parameter = fn.parameters[index];
    const symbol =
      parameter &&
      ts.isIdentifier(parameter.name) &&
      checker.getSymbolAtLocation(parameter.name);
    return !!symbol && runsParameter(checker, fn.body, symbol, seen);
  }
  if (ts.isNewExpression(call)) {
    return ts.isIdentifier(callee) && callee.text === "Promise" && index === 0;
  }
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const method = callee.name.text;
  const owner = unwrapped(callee.expression);
  if (ts.isIdentifier(owner) && owner.text === "Array" && method === "from") {
    return index === 1;
  }
  if (ts.isIdentifier(owner) && owner.text === "Promise" && method === "try") {
    return index === 0;
  }
  return RUNS_CALLBACKS.get(method)?.includes(index) ?? false;
}

/** Whether a name holds the parameter, directly or as in `const run = fn`. */
function refersTo(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  parameter: ts.Symbol,
  seen = new Set<ts.Node>(),
): boolean {
  const target = unbound(expression);
  if (!ts.isIdentifier(target)) return false;
  const symbol = checker.getSymbolAtLocation(target);
  if (symbol === parameter) return true;
  const declaration = symbolDeclaration(checker, symbol);
  if (
    !declaration ||
    seen.has(declaration) ||
    !ts.isVariableDeclaration(declaration) ||
    !declaration.initializer
  ) {
    return false;
  }
  seen.add(declaration);
  return refersTo(checker, declaration.initializer, parameter, seen);
}

/**
 * Whether this code runs the function a parameter holds: calls it, hands it
 * to a call that runs it, or calls a local function that does, as in
 * `const invoke = () => fn(); invoke();`.
 */
function runsParameter(
  checker: ts.TypeChecker,
  node: ts.Node,
  parameter: ts.Symbol,
  seen: Set<ts.Node>,
): boolean {
  if (ts.isCallExpression(node)) {
    const callee = invoked(node.expression);
    if (refersTo(checker, callee, parameter)) return true;
    const local = resolvedFunction(checker, callee, seen);
    if (local?.body && runsParameter(checker, local.body, parameter, seen)) {
      return true;
    }
  }
  if (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    node.arguments?.some(
      (argument, index) =>
        refersTo(checker, argument, parameter) &&
        runsArgument(checker, node, index, seen),
    )
  ) {
    return true;
  }
  return (
    ts.forEachChild(node, (child) =>
      ts.isFunctionLike(child) && !isRunByCall(checker, child, seen)
        ? false
        : runsParameter(checker, child, parameter, seen),
    ) ?? false
  );
}

/** Whether a function written into a call, as in `items.forEach(…)`, runs there. */
function isRunByCall(
  checker: ts.TypeChecker,
  fn: ts.Node,
  seen: Set<ts.Node>,
): boolean {
  let node = fn;
  while (
    ts.isParenthesizedExpression(node.parent) ||
    ts.isAsExpression(node.parent) ||
    ts.isSatisfiesExpression(node.parent)
  ) {
    node = node.parent;
  }
  const { parent } = node;
  if (!ts.isCallExpression(parent) && !ts.isNewExpression(parent)) {
    return false;
  }
  const index = parent.arguments?.indexOf(node as ts.Expression) ?? -1;
  return index >= 0 && runsArgument(checker, parent, index, seen);
}

/**
 * Whether a function passed by name, as in `items.forEach(record)` or
 * `.then(flush)`, counts when it runs there. (One written inline is followed
 * where `callsCount` walks into it.)
 */
function passedReferenceCounts(
  scope: FileScope,
  argument: ts.Expression,
  seen: Set<ts.Node>,
): boolean {
  const target = unbound(argument);
  return (
    (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target)) &&
    countsWhenCalled(scope, target, seen)
  );
}

function callsCount(
  scope: FileScope,
  node: ts.Node,
  seen: Set<ts.Node>,
): boolean {
  const { checker } = scope;
  if (
    ts.isCallExpression(node) &&
    countsWhenCalled(scope, node.expression, seen)
  ) {
    return true;
  }
  if (
    (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
    node.arguments?.some(
      (argument, index) =>
        runsArgument(checker, node, index, new Set()) &&
        passedReferenceCounts(scope, argument, seen),
    )
  ) {
    return true;
  }
  // A function defined here counts only where it runs: when it's handed to a
  // call that runs it, or where a call to its name is followed.
  return (
    ts.forEachChild(node, (child) =>
      ts.isFunctionLike(child) && !isRunByCall(checker, child, new Set())
        ? false
        : callsCount(scope, child, seen),
    ) ?? false
  );
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    !!ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * The names this file exports that count when called: exported functions and
 * consts, and re-exports, given what `known` says other files export.
 */
export function findCountingExports(
  file: string,
  source: string,
  known: CountingExports = new Map(),
  scopes?: Map<string, FileScope>,
): string[] {
  const scope = fileScope(file, source, known, scopes);
  const { sourceFile } = scope;
  const counts = (name: ts.Identifier) =>
    countsWhenCalled(scope, name, new Set());
  const counting = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (isExported(statement) && ts.isFunctionDeclaration(statement)) {
      if (statement.name && counts(statement.name)) {
        counting.add(statement.name.text);
      }
    } else if (isExported(statement) && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && counts(declaration.name)) {
          counting.add(declaration.name.text);
        }
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const module = statement.moduleSpecifier;
      const from =
        module && ts.isStringLiteral(module)
          ? scope.exportsOf(module.text)
          : undefined;
      const clause = statement.exportClause;
      if (!clause && from) {
        for (const name of from) counting.add(name);
      } else if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const local = (element.propertyName ?? element.name).text;
          const declaration =
            !from &&
            symbolDeclaration(
              scope.checker,
              scope.checker.getExportSpecifierLocalTargetSymbol(element),
            );
          const name = declaration
            ? ts.getNameOfDeclaration(declaration)
            : undefined;
          if (
            from
              ? from.has(local)
              : !!name && ts.isIdentifier(name) && counts(name)
          ) {
            counting.add(element.name.text);
          }
        }
      }
    }
  }
  return [...counting].sort();
}

const EXPORTS = /\bexport\b/;
const EXPORT_STAR = /\bexport\s*\*/;
/**
 * Text that can name a count helper the way `isCountName` reads names: a count
 * helper anywhere, or a `track…` name called, imported or destructured.
 */
const COUNT_WORD = new RegExp(
  `\\b(?:${[...COUNTS].join("|")})\\b|\\btrack(?:[A-Z]\\w*)?(?:\\s*[(:,}]|\\s+as\\b)`,
);

/**
 * The counting exports across these files (repo-relative path to source),
 * worked to a fixpoint so a wrapper of a counting export counts too.
 */
export function countingExportsOf(
  sources: ReadonlyMap<string, string>,
  scopes?: Map<string, FileScope>,
): CountingExports {
  const known = new Map<string, Set<string>>();
  const pending = new Set(
    [...sources]
      .filter(([, source]) => EXPORTS.test(source) && COUNT_WORD.test(source))
      .map(([file]) => file),
  );
  while (pending.size > 0) {
    const [file] = pending;
    pending.delete(file);
    const names = findCountingExports(
      file,
      sources.get(file) ?? "",
      known,
      scopes,
    );
    const added = names.filter((name) => !known.get(file)?.has(name));
    if (added.length === 0) continue;
    known.set(file, new Set(names));
    // A file that passes the exports on imports their module by a path that
    // names it, then names the exports or re-exports them all.
    const stem = path.posix.basename(file).replace(/\.[^.]+$/, "");
    const module =
      stem === "index" ? path.posix.basename(path.posix.dirname(file)) : stem;
    for (const [other, source] of sources) {
      if (
        other !== file &&
        EXPORTS.test(source) &&
        source.includes(module) &&
        (EXPORT_STAR.test(source) ||
          added.some((name) => source.includes(name)))
      ) {
        pending.add(other);
      }
    }
  }
  return known;
}

export function findDeferredCounts(
  file: string,
  source: string,
  known: CountingExports = new Map(),
  scopes?: Map<string, FileScope>,
): DeferredCountFinding[] {
  const scope = fileScope(file, source, known, scopes);
  const { sourceFile, checker } = scope;
  const lines = source.split(/\r?\n/);
  const findings: DeferredCountFinding[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      isTimerReference(checker, node.expression, new Set()) &&
      countsWhenCalled(scope, node.arguments[0], new Set())
    ) {
      const start =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      const opted =
        lines.slice(start - 1, end).some((line) => PRAGMA.test(line)) ||
        PRAGMA.test(lines[start - 2] ?? "");
      if (!opted) {
        findings.push({
          file,
          line: start,
          snippet: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 120),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function serverSourceFiles(): string[] {
  const listed = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--",
      "templates",
      "community-templates",
      "apps",
      "packages",
    ],
    { cwd: rootDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return listed.split("\0").filter((rel) => rel && isServerSourcePath(rel));
}

function main() {
  let files: string[];
  try {
    files = serverSourceFiles();
  } catch (error) {
    console.error(
      `${GUARD_NAME}: could not list files: ${(error as Error).message}`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  const sources = new Map<string, string>();
  for (const rel of files) {
    try {
      sources.set(rel, readFileSync(path.join(rootDir, rel), "utf8"));
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
  }
  const inspected = sources.size;
  const scopes = new Map<string, FileScope>();
  const known = countingExportsOf(sources, scopes);
  const findings: DeferredCountFinding[] = [];
  for (const [rel, source] of sources) {
    if (!TIMER_WORD.test(source)) continue;
    findings.push(...findDeferredCounts(rel, source, known, scopes));
  }

  if (findings.length === 0) {
    console.log(`${GUARD_NAME}: OK (${inspected} server file(s) inspected)`);
    return;
  }

  console.error(
    `${GUARD_NAME}: ${findings.length} count(s) deferred past the request.`,
  );
  console.error(
    "\nA serverless instance can freeze once the response is sent, so a count\n" +
      "scheduled on a timer may never run. Count inside the request, and keep\n" +
      "it from changing the response:\n\n" +
      "  try {\n" +
      '    countOutcome("<thing>_counts", dimensions);\n' +
      "  } catch {\n" +
      "    // coercion-ok: a count cannot change the response.\n" +
      "  }\n",
  );
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.snippet}`);
  }
  console.error(
    "\nIf the count really can wait, say why on the timer call or the line\n" +
      "above it:\n" +
      "  // guard:allow-deferred-count — <why>\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
