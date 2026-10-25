/**
 * guard-no-deferred-server-counts.ts
 *
 * Server code counts and tracks inside the request. A serverless instance can
 * freeze once the response is sent, so a count scheduled with `setTimeout`,
 * `setImmediate` or `queueMicrotask` may run only when the instance next
 * thaws, or never. Content's save-outcome and editor-mount counters both
 * deferred their count this way.
 *
 * `countOutcome` only bumps an in-memory window, so call it in the request and
 * keep it from changing the response:
 *
 *   try {
 *     const delivery: unknown = countOutcome("<thing>_counts", dimensions);
 *     void Promise.resolve(delivery).catch(() => {});
 *   } catch {}
 *
 * The guard scans every server source file (actions and server directories)
 * for a timer callback that calls a tracking or count function. A timer that
 * has to defer one says why, on any line of the timer call or the line above:
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
  /^(?:(?:templates|apps)\/[^/]+\/(?:actions|server)\/|packages\/[^/]+\/src\/(?:.+\/)?(?:actions|server)\/)/;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TIMERS = new Set(["setTimeout", "setImmediate", "queueMicrotask"]);
const COUNTS = new Set([
  "track",
  "trackEvent",
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

function callsCount(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression);
    if (name && COUNTS.has(name)) return true;
  }
  return ts.forEachChild(node, callsCount) ?? false;
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

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const callback = node.arguments[0];
      if (
        name &&
        TIMERS.has(name) &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        callsCount(callback.body)
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
    ["ls-files", "-z", "--", "templates", "apps", "packages"],
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
    if (!/setTimeout|setImmediate|queueMicrotask/.test(source)) continue;
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
      '    const delivery: unknown = countOutcome("<thing>_counts", dimensions);\n' +
      "    void Promise.resolve(delivery).catch(() => {});\n" +
      "  } catch {}\n",
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
