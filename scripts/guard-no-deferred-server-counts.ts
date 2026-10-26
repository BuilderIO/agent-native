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
 * is a function another scanned server file exports, named or default, when
 * it's imported by a relative path: `recordContentSaveOutcome` counts because
 * its own file shows it calling `countOutcome`, and so does a wrapper of it,
 * while an imported `trackRetry` whose file shows it only retrying doesn't.
 * That holds through re-exports, including `export *` and `export * as`, for
 * members of exported objects, classes and instances, with what they spread
 * or inherit (`counters.record()`, `new Reporter().record()`), and for names
 * destructured from them. A package import is judged by its name, and so is
 * a `count…` helper the repo's packages export, such as
 * `countAutomationCredentialState`, once a package file shows it counting.
 * Any other name whose function the guard can't see (a global, a parameter,
 * a factory's result, a member of an object it can't list) is judged by its
 * name. A function a callback only defines or passes along counts where it
 * runs: where a call to it is followed, or when it's handed to a call that
 * runs it (a function in the file that calls that parameter, or else an array
 * iteration or promise method, a promise executor, or `Array.from`'s mapper).
 * A call that may only keep the function, such as `register(flush)`,
 * `cache.set(key, flush)` or a helper from another file, isn't taken to run
 * it. A timer that has to defer a count says why, on any line of the timer
 * call or the line above:
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
 * What scanned server files export that counts when called, by the file's
 * repo-relative path. `record` is an export that counts, and `counters.record`
 * a member that counts, of an exported object, an exported class's statics or
 * a namespace re-export. `counters.` marks an export whose members are all
 * listed, so a member not listed doesn't count; the members of other exports
 * are judged by name. A file's own exports are all listed unless it has `*`,
 * from re-exporting everything from a module the guard doesn't scan.
 */
export type CountingExports = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * What a scanned module's exports say about calling the export or member at
 * `path`: yes, no, or `undefined` when the module doesn't list what's there,
 * so the name decides.
 */
function exportCounts(
  exports: ReadonlySet<string>,
  path: readonly string[],
): boolean | undefined {
  if (exports.has(path.join("."))) return true;
  const listed =
    path.length === 1
      ? !exports.has("*")
      : exports.has(`${path.slice(0, -1).join(".")}.`);
  return listed ? false : undefined;
}

/**
 * The `CountingExports` key for the `count…` helpers the repo's packages
 * export, such as `countAutomationCredentialState`, with `*`. An import from
 * `@agent-native/...` can't be traced to its file, so a name listed here
 * counts and any other is judged by its spelling. Only `count…` names join:
 * `track…` names already count by spelling, and a generic name such as `run`
 * would stand for every package's `run`.
 */
export const PACKAGE_EXPORTS = "@agent-native/*";

/** What a file's names resolve to. */
interface FileScope {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  /**
   * The counting exports of the scanned module a specifier names, or
   * `undefined` when it names no scanned module.
   */
  exportsOf: (specifier: string) => ReadonlySet<string> | undefined;
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
      if (specifier.startsWith("@agent-native/")) {
        return known.get(PACKAGE_EXPORTS);
      }
      for (const candidate of importCandidates(file, specifier)) {
        const names = known.get(candidate);
        if (names) return names;
      }
      return undefined;
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

interface ImportedPath {
  specifier: string;
  /** The export, then any members, as `CountingExports` lists them. */
  path: string[];
}

/**
 * The module an import declaration binds and where in its exports: `record`
 * for `import { record }`, `default` for `import record from`, and the whole
 * module for `import * as outcomes`.
 */
function importBinding(
  declaration: ts.Declaration | undefined,
): ImportedPath | undefined {
  let module: ts.Expression | undefined;
  let path: string[] = [];
  if (!declaration) return undefined;
  if (ts.isImportClause(declaration)) {
    module = declaration.parent.moduleSpecifier;
    path = ["default"];
  } else if (ts.isImportSpecifier(declaration)) {
    module = declaration.parent.parent.parent.moduleSpecifier;
    path = [(declaration.propertyName ?? declaration.name).text];
  } else if (ts.isNamespaceImport(declaration)) {
    module = declaration.parent.parent.moduleSpecifier;
  }
  return module && ts.isStringLiteral(module)
    ? { specifier: module.text, path }
    : undefined;
}

/**
 * Where in its module a value comes from, when it comes from an import:
 * through members (`counters.record`), destructuring (`const { record } =
 * counters`), aliases, and instances (`new Reporter()` reaches
 * `Reporter.prototype`). The path is empty for `import * as` itself.
 */
function valuePath(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen: Set<ts.Node>,
): ImportedPath | undefined {
  const target = unwrapped(expression);
  if (ts.isNewExpression(target)) {
    const made = valuePath(checker, target.expression, seen);
    return made && made.path.length > 0
      ? { specifier: made.specifier, path: [...made.path, "prototype"] }
      : undefined;
  }
  if (!ts.isIdentifier(target) && !ts.isPropertyAccessExpression(target)) {
    return undefined;
  }
  const declaration = declarationOf(checker, target);
  if (declaration) return declaredPath(checker, declaration, seen);
  if (!ts.isPropertyAccessExpression(target)) return undefined;
  const object = valuePath(checker, target.expression, seen);
  return (
    object && {
      specifier: object.specifier,
      path: [...object.path, target.name.text],
    }
  );
}

/** Where in an import a declaration's value comes from, if it does. */
function declaredPath(
  checker: ts.TypeChecker,
  declaration: ts.Declaration,
  seen: Set<ts.Node>,
): ImportedPath | undefined {
  if (seen.has(declaration)) return undefined;
  seen.add(declaration);
  const binding = importBinding(declaration);
  if (binding) return binding;
  if (
    ts.isBindingElement(declaration) &&
    ts.isObjectBindingPattern(declaration.parent)
  ) {
    const key = sourceName(declaration);
    const holder = declaration.parent.parent;
    const object = ts.isBindingElement(holder)
      ? declaredPath(checker, holder, seen)
      : ts.isVariableDeclaration(holder) && holder.initializer
        ? valuePath(checker, holder.initializer, seen)
        : undefined;
    return key && object
      ? { specifier: object.specifier, path: [...object.path, key] }
      : undefined;
  }
  if (
    (ts.isVariableDeclaration(declaration) ||
      ts.isPropertyDeclaration(declaration)) &&
    declaration.initializer
  ) {
    return valuePath(checker, declaration.initializer, seen);
  }
  return undefined;
}

/**
 * The module and export path a reference imports: `record` itself, or a member
 * reached through an import, as `counters.record` after `import { counters }`,
 * `const { record } = counters`, or `outcomes.record` after
 * `import * as outcomes`.
 */
function importedPath(
  checker: ts.TypeChecker,
  target: ts.Identifier | ts.PropertyAccessExpression,
  declaration: ts.Declaration | undefined,
): ImportedPath | undefined {
  const found = declaration
    ? declaredPath(checker, declaration, new Set())
    : valuePath(checker, target, new Set());
  return found && found.path.length > 0 ? found : undefined;
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
    const imported = importedPath(checker, target, declaration);
    const exports = imported && scope.exportsOf(imported.specifier);
    // A scanned module answers for what it lists, yes or no, whatever the
    // name.
    const answer =
      imported && exports ? exportCounts(exports, imported.path) : undefined;
    if (answer !== undefined) return answer;
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

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    !!ts.getModifiers(node)?.some((modifier) => modifier.kind === kind)
  );
}

function isExported(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.ExportKeyword);
}

function isDefault(statement: ts.Statement): boolean {
  return hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
}

/**
 * What this file exports that counts when called, listed as `CountingExports`
 * lists it: exported functions and consts, the members of exported objects,
 * classes and instances (with what they spread or inherit), and re-exports,
 * given what `known` says other files export.
 */
export function findCountingExports(
  file: string,
  source: string,
  known: CountingExports = new Map(),
  scopes?: Map<string, FileScope>,
): string[] {
  const scope = fileScope(file, source, known, scopes);
  const { sourceFile, checker } = scope;
  const counts = (expression: ts.Expression) =>
    countsWhenCalled(scope, expression, new Set());
  const counting = new Set<string>();

  // Lists under `prefix` what `from` says counts at `path` and below.
  const copyCounting = (
    from: ReadonlySet<string>,
    path: readonly string[],
    prefix: string,
  ) => {
    const at = path.join(".");
    for (const entry of from) {
      if (entry === "*" || entry.endsWith(".")) continue;
      if (path.length === 0) counting.add(`${prefix}.${entry}`);
      else if (entry.startsWith(`${at}.`)) {
        counting.add(prefix + entry.slice(at.length));
      }
    }
  };

  // Lists what counts among a value's members under `prefix`: an object's
  // properties, a class's statics and, under `prefix.prototype`, its instance
  // members, or with `instance` the members of an instance. Returns the
  // levels whose members are all listed.
  const listMembers = (
    prefix: string,
    node: ts.Node | undefined,
    instance: boolean,
    seen: Set<ts.Node>,
  ): Set<string> => {
    const levels = new Set<string>();
    const value = node && ts.isExpression(node) ? unwrapped(node) : node;
    if (!value || seen.has(value)) return levels;
    seen.add(value);
    try {
      if (ts.isNewExpression(value)) {
        return listMembers(prefix, value.expression, true, seen);
      }
      if (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value)) {
        const declaration = declarationOf(checker, value);
        const local =
          declaration &&
          (ts.isClassDeclaration(declaration)
            ? declaration
            : boundValue(checker, declaration));
        if (local) return listMembers(prefix, local, instance, seen);
        // A value from another scanned file has what that file lists, and
        // what it doesn't list is left to the name.
        const imported = declaration
          ? declaredPath(checker, declaration, new Set())
          : valuePath(checker, value, new Set());
        const from = imported && scope.exportsOf(imported.specifier);
        if (imported && from) {
          copyCounting(
            from,
            instance ? [...imported.path, "prototype"] : imported.path,
            prefix,
          );
        }
        return levels;
      }
      if (ts.isObjectLiteralExpression(value)) {
        if (!instance && listProperties(prefix, value.properties, seen)) {
          levels.add(prefix);
        }
        return levels;
      }
      if (ts.isClassDeclaration(value) || ts.isClassExpression(value)) {
        const isStatic = (member: ts.ClassElement) =>
          hasModifier(member, ts.SyntaxKind.StaticKeyword);
        const own = instance ? prefix : `${prefix}.prototype`;
        if (
          !instance &&
          listProperties(prefix, value.members.filter(isStatic), seen)
        ) {
          levels.add(prefix);
        }
        if (
          listProperties(
            own,
            value.members.filter((member) => !isStatic(member)),
            seen,
          )
        ) {
          levels.add(own);
        }
        const base = value.heritageClauses?.find(
          (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
        )?.types[0]?.expression;
        if (base) {
          // A subclass has what its base has, and lists a level only when
          // the base lists it too.
          const inherited = listMembers(prefix, base, instance, seen);
          for (const level of levels) {
            if (!inherited.has(level)) levels.delete(level);
          }
        }
      }
      return levels;
    } finally {
      seen.delete(value);
    }
  };

  // Lists the members that count under `prefix`, and says whether these are
  // all the members.
  const listProperties = (
    prefix: string,
    members: readonly (ts.ObjectLiteralElementLike | ts.ClassElement)[],
    seen: Set<ts.Node>,
  ): boolean => {
    let listed = true;
    for (const member of members) {
      if (
        ts.isClassStaticBlockDeclaration(member) ||
        ts.isSemicolonClassElement(member) ||
        ts.isIndexSignatureDeclaration(member)
      ) {
        continue;
      }
      if (ts.isConstructorDeclaration(member)) {
        // `constructor(private save: Save)` adds a member this can't list.
        if (
          member.parameters.some((parameter) =>
            ts.isParameterPropertyDeclaration(parameter, member),
          )
        ) {
          listed = false;
        }
        continue;
      }
      if (ts.isSpreadAssignment(member)) {
        // `{ ...counters }` has what `counters` has.
        if (!listMembers(prefix, member.expression, false, seen).has(prefix)) {
          listed = false;
        }
        continue;
      }
      const key =
        member.name &&
        (ts.isIdentifier(member.name) ||
          ts.isStringLiteral(member.name) ||
          ts.isNumericLiteral(member.name))
          ? member.name.text
          : undefined;
      if (!key || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
        // A computed name or an accessor hides what's there.
        listed = false;
        continue;
      }
      const path = `${prefix}.${key}`;
      let value: ts.Expression | undefined;
      if (ts.isMethodDeclaration(member)) {
        if (member.body && callsCount(scope, member.body, new Set())) {
          counting.add(path);
        }
      } else if (ts.isShorthandPropertyAssignment(member)) {
        value = member.name;
      } else if (
        ts.isPropertyAssignment(member) ||
        ts.isPropertyDeclaration(member)
      ) {
        value = member.initializer;
      }
      if (value && counts(value)) counting.add(path);
      for (const level of listMembers(path, value, false, seen)) {
        counting.add(`${level}.`);
      }
    }
    return listed;
  };

  const addMembers = (prefix: string, node: ts.Node | undefined) => {
    for (const level of listMembers(prefix, node, false, new Set())) {
      counting.add(`${level}.`);
    }
  };

  // Lists as `name` what `from` lists at `path`: one export and its members,
  // or with an empty path the whole module, as `export * as name` does, or
  // with an empty name too, as `export *` does.
  const passOn = (
    from: ReadonlySet<string> | undefined,
    path: readonly string[],
    name: string,
  ) => {
    if (!from) {
      // A module the guard doesn't scan, such as a package: the name decides.
      if (path.length === 0 && !name) counting.add("*");
      if (path.length === 1 && isCountName(path[0])) counting.add(name);
      return;
    }
    const at = path.join(".");
    for (const entry of from) {
      if (path.length > 0) {
        if (entry === at || entry.startsWith(`${at}.`)) {
          counting.add(name + entry.slice(at.length));
        }
      } else if (name) {
        if (entry !== "*") counting.add(`${name}.${entry}`);
      } else if (entry !== "default" && !entry.startsWith("default.")) {
        counting.add(entry);
      }
    }
    if (path.length === 0 && name && !from.has("*")) counting.add(`${name}.`);
    if (
      path.length === 1 &&
      exportCounts(from, path) === undefined &&
      isCountName(path[0])
    ) {
      counting.add(name);
    }
  };

  // What a declaration in this file exports as `name`.
  const addDeclaration = (name: string, declaration: ts.Declaration) => {
    const imported = importBinding(declaration);
    if (imported) {
      passOn(scope.exportsOf(imported.specifier), imported.path, name);
      return;
    }
    if (ts.isClassDeclaration(declaration)) {
      addMembers(name, declaration);
      return;
    }
    const reference = ts.getNameOfDeclaration(declaration);
    if (reference && ts.isIdentifier(reference)) {
      if (counts(reference)) counting.add(name);
      addMembers(name, reference);
    }
  };

  // `export const { record } = counters` exports each name it binds.
  const addBound = (
    declaration: ts.VariableDeclaration | ts.BindingElement,
  ) => {
    if (ts.isIdentifier(declaration.name)) {
      addDeclaration(declaration.name.text, declaration);
      return;
    }
    for (const element of declaration.name.elements) {
      if (ts.isBindingElement(element)) addBound(element);
    }
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      // `export default () => track(...)`, `export default { record() {...} }`
      if (statement.isExportEquals) continue;
      if (counts(statement.expression)) counting.add("default");
      addMembers("default", statement.expression);
    } else if (
      isExported(statement) &&
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
    ) {
      const name =
        isDefault(statement) || !statement.name
          ? "default"
          : statement.name.text;
      if (statement.name) {
        addDeclaration(name, statement);
      } else if (ts.isClassDeclaration(statement)) {
        addMembers(name, statement);
      } else if (
        // `export default function () {...}` has no name to resolve.
        statement.body &&
        callsCount(scope, statement.body, new Set())
      ) {
        counting.add(name);
      }
    } else if (isExported(statement) && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        addBound(declaration);
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const module = statement.moduleSpecifier;
      const clause = statement.exportClause;
      if (module && ts.isStringLiteral(module)) {
        const from = scope.exportsOf(module.text);
        if (!clause) {
          passOn(from, [], "");
        } else if (ts.isNamespaceExport(clause)) {
          passOn(from, [], clause.name.text);
        } else {
          for (const element of clause.elements) {
            passOn(
              from,
              [(element.propertyName ?? element.name).text],
              element.name.text,
            );
          }
        }
      } else if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const declaration = symbolDeclaration(
            checker,
            checker.getExportSpecifierLocalTargetSymbol(element),
          );
          if (declaration) addDeclaration(element.name.text, declaration);
        }
      }
    }
  }
  return [...counting].sort();
}

const EXPORTS = /\bexport\b/;
/** A file that calls a count helper or `track` itself. */
const COUNTS_ITSELF = new RegExp(
  `\\b(?:${[...COUNTS].join("|")})\\b|(?:^|[^.\\w])track\\s*\\(`,
  "m",
);
const EXPORT_STAR = /\bexport\s*\*/;
/** `export * from` a package or another module the guard doesn't scan. */
const PACKAGE_STAR = /\bexport\s*\*\s*from\s*["'][^.]/;
/**
 * Text that can name a count helper the way `isCountName` reads names: a count
 * helper anywhere, or a `track…` name called, imported or destructured.
 */
const COUNT_WORD = new RegExp(
  `\\b(?:${[...COUNTS].join("|")})\\b|\\btrack(?:[A-Z]\\w*)?(?:\\s*[(:,;)\\]}]|\\s+as\\b)`,
);

/**
 * The counting exports across these files (repo-relative path to source),
 * worked to a fixpoint so a wrapper of a counting export counts too.
 */
export function countingExportsOf(
  sources: ReadonlyMap<string, string>,
  scopes?: Map<string, FileScope>,
): CountingExports {
  // Every scanned file answers for its exports, even when none count.
  const known = new Map(
    [...sources.keys()].map((file) => [file, new Set<string>()]),
  );
  const fromPackages = new Set(["*"]);
  known.set(PACKAGE_EXPORTS, fromPackages);
  // A file starts with what it names itself, or what it re-exports whole from
  // a module the guard doesn't scan.
  const pending = new Set(
    [...sources]
      .filter(
        ([, source]) =>
          EXPORTS.test(source) &&
          (COUNT_WORD.test(source) || PACKAGE_STAR.test(source)),
      )
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
    const before = known.get(file) ?? new Set<string>();
    const added = names.filter((name) => !before.has(name));
    const removed = [...before].filter((name) => !names.includes(name));
    if (added.length === 0 && removed.length === 0) continue;
    known.set(file, new Set(names));
    // A package's `count…` helpers join the names its importers look up.
    const packaged = file.startsWith("packages/")
      ? added.filter(
          (name) =>
            /^count[A-Z]\w*$/.test(name) &&
            !isCountName(name) &&
            !fromPackages.has(name),
        )
      : [];
    for (const name of packaged) fromPackages.add(name);
    if (packaged.length > 0) {
      for (const [other, source] of sources) {
        if (
          other !== file &&
          EXPORTS.test(source) &&
          source.includes("@agent-native/") &&
          packaged.some((name) => source.includes(name))
        ) {
          pending.add(other);
        }
      }
    }
    // Files that pass the exports on import their module by a path that names
    // it. They're checked again when a counting export or member appears,
    // when anything is dropped, or when the file gains `*`; a new `counters.`
    // alone only answers no, which the files passing it on can leave to the
    // name.
    const counting = [
      ...added.filter((name) => name !== "*" && !name.endsWith(".")),
      ...removed,
    ].map((name) => name.split(".")[0]);
    const opened = added.includes("*");
    if (counting.length === 0 && !opened) continue;
    const stem = path.posix.basename(file).replace(/\.[^.]+$/, "");
    const literal = (text: string) =>
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tail =
      stem === "index"
        ? `${literal(path.posix.basename(path.posix.dirname(file)))}(?:/index)?`
        : literal(stem);
    const importsModule = new RegExp(
      `["'][^"'\\n]*/${tail}(?:\\.[cm]?[jt]sx?)?["']`,
    );
    for (const [other, source] of sources) {
      if (
        other !== file &&
        EXPORTS.test(source) &&
        importsModule.test(source) &&
        (EXPORT_STAR.test(source) ||
          // A name re-exported from a file with `*` is judged by its name.
          (opened && COUNT_WORD.test(source)) ||
          counting.some(
            (head) =>
              head === "*" || head === "default" || source.includes(head),
          ))
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

/**
 * Package sources outside the server directories, read only for what they
 * export when they count themselves: core's count helpers, such as
 * `countAutomationCredentialState` in `packages/core/src/jobs/`, live there.
 */
function isPackageHelperPath(relPath: string): boolean {
  return (
    /^packages\/[^/]+\/src\//.test(relPath) &&
    /\.[cm]?ts$/.test(relPath) &&
    !/\.d\.[cm]?ts$/.test(relPath) &&
    !SKIPPED.test(relPath) &&
    !isServerSourcePath(relPath)
  );
}

function sourceFiles(): { server: string[]; helpers: string[] } {
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
  const files = listed.split("\0").filter(Boolean);
  return {
    server: files.filter(isServerSourcePath),
    helpers: files.filter(isPackageHelperPath),
  };
}

function main() {
  let files: { server: string[]; helpers: string[] };
  try {
    files = sourceFiles();
  } catch (error) {
    console.error(
      `${GUARD_NAME}: could not list files: ${(error as Error).message}`,
    );
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }

  const sources = new Map<string, string>();
  for (const rel of [...files.server, ...files.helpers]) {
    try {
      const source = readFileSync(path.join(rootDir, rel), "utf8");
      if (isServerSourcePath(rel) || COUNTS_ITSELF.test(source)) {
        sources.set(rel, source);
      }
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
  }
  const inspected = files.server.length;
  const scopes = new Map<string, FileScope>();
  const known = countingExportsOf(sources, scopes);
  const findings: DeferredCountFinding[] = [];
  for (const rel of files.server) {
    const source = sources.get(rel) ?? "";
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
