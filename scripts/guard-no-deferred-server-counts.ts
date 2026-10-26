/**
 * guard-no-deferred-server-counts.ts
 *
 * Server code counts and tracks inside the request. A serverless instance can
 * freeze once the response is sent, so a count scheduled with `setTimeout`,
 * `setInterval`, `setImmediate` or `queueMicrotask` may run only when the
 * instance next thaws, or never. Content's save-outcome and editor-mount counters both
 * deferred their count this way.
 *
 * `countOutcome` only bumps an in-memory window, so call it in the request and
 * keep it from changing the response:
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
 * (`this.flush`, `queue.flush`), the functions and methods they call, and
 * timers renamed through any chain of aliases (`const defer = setTimeout`).
 * It does not follow helpers imported from other files unless their names say
 * they track or count. A timer that has to defer a count says why, on any line
 * of the timer call or the line above:
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
 * A type checker over this one file, so a name resolves to the declaration its
 * scope sees, and `this.flush` or `queue.flush` to the method. Imports stay
 * unresolved, so helpers from other files are judged by name.
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

/** The declaration a name or property reference resolves to in this file. */
function declarationOf(
  checker: ts.TypeChecker,
  reference: ts.Identifier | ts.PropertyAccessExpression,
): ts.Declaration | undefined {
  const symbol = checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(reference) ? reference.name : reference,
  );
  const declaration =
    symbol?.declarations?.find((candidate) => bodyOf(candidate)) ??
    symbol?.valueDeclaration ??
    symbol?.declarations?.[0];
  if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
    const value = checker.getShorthandAssignmentValueSymbol(declaration);
    return value?.valueDeclaration ?? value?.declarations?.[0];
  }
  return declaration;
}

/** What a declaration binds: a function, another expression, or nothing. */
function boundValue(declaration: ts.Declaration): ts.Node | undefined {
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
  const value = boundValue(declaration);
  return (
    !!value && ts.isExpression(value) && isTimerReference(checker, value, seen)
  );
}

/** Whether calling this reference tracks or counts, as far as the file shows. */
function countsWhenCalled(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen: Set<ts.Node>,
): boolean {
  const target = unbound(expression);
  const body = bodyOf(target);
  if (body) return callsCount(checker, body, seen);
  const name = calleeName(target);
  if (name && isCountName(name)) return true;
  if (!ts.isIdentifier(target) && !ts.isPropertyAccessExpression(target)) {
    return false;
  }
  const declaration = declarationOf(checker, target);
  if (!declaration || seen.has(declaration)) return false;
  seen.add(declaration);
  // `import { countOutcome as record }`
  if (ts.isImportSpecifier(declaration)) {
    return isCountName((declaration.propertyName ?? declaration.name).text);
  }
  const value = boundValue(declaration);
  if (!value) return false;
  const valueBody = bodyOf(value);
  if (valueBody) return callsCount(checker, valueBody, seen);
  return ts.isExpression(value) && countsWhenCalled(checker, value, seen);
}

function callsCount(
  checker: ts.TypeChecker,
  node: ts.Node,
  seen: Set<ts.Node>,
): boolean {
  if (
    ts.isCallExpression(node) &&
    countsWhenCalled(checker, node.expression, seen)
  ) {
    return true;
  }
  return (
    ts.forEachChild(node, (child) => callsCount(checker, child, seen)) ?? false
  );
}

export function findDeferredCounts(
  file: string,
  source: string,
): DeferredCountFinding[] {
  const kind = /\.[cm]?tsx$|\.[cm]?jsx$/.test(file)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    kind === ts.ScriptKind.TSX ? "/guarded.tsx" : "/guarded.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const checker = fileChecker(sourceFile);
  const lines = source.split(/\r?\n/);
  const findings: DeferredCountFinding[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      isTimerReference(checker, node.expression, new Set()) &&
      countsWhenCalled(checker, node.arguments[0], new Set())
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

  let inspected = 0;
  const findings: DeferredCountFinding[] = [];
  for (const rel of files) {
    let source: string;
    try {
      source = readFileSync(path.join(rootDir, rel), "utf8");
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    inspected += 1;
    if (!TIMER_WORD.test(source)) continue;
    findings.push(...findDeferredCounts(rel, source));
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
