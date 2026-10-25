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
 * count helper. It follows a callback passed by name, functions the same file
 * defines, and names the file binds to a timer (`const defer = setTimeout`).
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

function functionBody(node: ts.Node | undefined): ts.Node | undefined {
  if (!node) return undefined;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return node.body;
  }
  return undefined;
}

/** Functions the file defines by name, so a helper's count is seen. */
function localFunctions(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, node.body);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const body = functionBody(node.initializer);
      if (body) functions.set(node.name.text, body);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function isTimerReference(expression: ts.Expression): boolean {
  const name = calleeName(expression);
  if (name && TIMERS.has(name)) return true;
  // `setTimeout.bind(globalThis)`
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "bind" &&
    isTimerReference(expression.expression.expression)
  );
}

/** Names the file binds to a timer, such as `const defer = setTimeout`. */
function timerAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isTimerReference(node.initializer)
    ) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function callsCount(
  node: ts.Node,
  functions: ReadonlyMap<string, ts.Node>,
  followed: Set<string>,
): boolean {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    if (name && isCountName(name)) return true;
    if (name && ts.isIdentifier(node.expression) && !followed.has(name)) {
      followed.add(name);
      const helper = functions.get(name);
      if (helper && callsCount(helper, functions, followed)) return true;
    }
  }
  return (
    ts.forEachChild(node, (child) => callsCount(child, functions, followed)) ??
    false
  );
}

function deferredCallbackCounts(
  callback: ts.Expression | undefined,
  functions: ReadonlyMap<string, ts.Node>,
): boolean {
  if (!callback) return false;
  if (ts.isIdentifier(callback)) {
    if (isCountName(callback.text)) return true;
    const helper = functions.get(callback.text);
    return !!helper && callsCount(helper, functions, new Set([callback.text]));
  }
  const body = functionBody(callback);
  return !!body && callsCount(body, functions, new Set());
}

export function findDeferredCounts(
  file: string,
  source: string,
): DeferredCountFinding[] {
  const kind = /\.[cm]?tsx$|\.[cm]?jsx$/.test(file)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const lines = source.split(/\r?\n/);
  const findings: DeferredCountFinding[] = [];
  const functions = localFunctions(sourceFile);
  const aliases = timerAliases(sourceFile);
  const isTimer = (expression: ts.Expression) =>
    (ts.isIdentifier(expression) && aliases.has(expression.text)) ||
    TIMERS.has(calleeName(expression) ?? "");

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (
        isTimer(node.expression) &&
        deferredCallbackCounts(node.arguments[0], functions)
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
            snippet: node
              .getText(sourceFile)
              .replace(/\s+/g, " ")
              .slice(0, 120),
          });
        }
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
