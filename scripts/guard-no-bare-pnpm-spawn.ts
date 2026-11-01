/**
 * guard-no-bare-pnpm-spawn.ts
 *
 * On Windows, pnpm is usually a `pnpm.cmd` shim. Node refuses to start a
 * `.cmd` file without a shell (CVE-2024-27980, Node 18.20.2 and 20.12.2 on),
 * and without a shell it only finds `.exe` and `.com` files on PATH. So
 * `spawn("pnpm.cmd", args)` fails with `spawn EINVAL`, and `spawn("pnpm", args)`
 * fails with `spawn pnpm ENOENT` unless a real `pnpm.exe` happens to be on
 * PATH. That broke the root `pnpm typecheck`, `pnpm test` and `pnpm lint` on
 * Windows, and the workspace gateway behind `pnpm dev` (issue #8348).
 *
 * This guard scans lines ADDED on this branch (via scripts/lib/changed-lines.mjs)
 * and flags a `spawn`, `spawnSync`, `execFile` or `execFileSync` call that
 * starts pnpm (or pnpx) with no `shell` option. Root scripts start pnpm
 * through scripts/lib/pnpm-command.ts; elsewhere, pass
 * `shell: process.platform === "win32"` (or run the joined command line with
 * `shell: true` on Windows, as the helper does). It also flags a new
 * `"pnpm.cmd"`-style literal, which only exists to spawn the shim without a
 * shell. `exec` and `execSync` always use a shell, so they are not checked.
 *
 * A call that really never runs on Windows can say so, on any line of the call
 * or on the line immediately above it:
 *
 *   // guard:allow-bare-pnpm — <why this never runs on Windows>
 *
 * `--all` scans every tracked source file instead of the branch's added lines.
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-bare-pnpm-spawn";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-bare-pnpm\b/;
// Above a call, the pragma must be the whole line, not another call's comment.
const PRAGMA_LINE = /^\s*(?:\/\/|\/\*)\s*guard:allow-bare-pnpm\b/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const SKIPPED = /(?:^|\/)(?:node_modules|dist|build)\//;
const SPAWNERS = new Set(["spawn", "spawnSync", "execFile", "execFileSync"]);
const PNPM = /^pnp[mx](?:\.cmd)?$/i;
const CMD_SHIM = /^pnp[mx]\.cmd$/i;

export interface BareSpawnFinding {
  file: string;
  line: number;
  snippet: string;
}

export function isGuardedSourcePath(relPath: string): boolean {
  return SOURCE_FILE.test(relPath) && !SKIPPED.test(relPath);
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function literalValue(node: ts.Expression): string | null {
  const inner = unwrap(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
    return inner.text;
  }
  return null;
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** `const name = <initializer>` declarations in the file, by name. */
function constInitializers(sourceFile: ts.SourceFile) {
  const found = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      found.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Return values of the file's own functions, by name, for `pnpmCommand()`. */
function functionReturns(sourceFile: ts.SourceFile) {
  const found = new Map<string, ts.Expression[]>();
  const collect = (name: string, body: ts.Node) => {
    const returns: ts.Expression[] = [];
    if (!ts.isBlock(body)) {
      returns.push(body as ts.Expression);
    } else {
      const walk = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression) {
          returns.push(node.expression);
        }
        ts.forEachChild(node, walk);
      };
      ts.forEachChild(body, walk);
    }
    found.set(name, returns);
  };
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      collect(node.name.text, node.body);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      collect(node.name.text, node.initializer.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function findBarePnpmSpawns(
  file: string,
  source: string,
  addedLines: ReadonlySet<number> | "all",
): BareSpawnFinding[] {
  const kind = /\.[cm]?[jt]sx$/.test(file)
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
  const consts = constInitializers(sourceFile);
  const returns = functionReturns(sourceFile);
  const findings: BareSpawnFinding[] = [];

  const namesPnpm = (
    node: ts.Expression,
    seen = new Set<string>(),
  ): boolean => {
    const inner = unwrap(node);
    const value = literalValue(inner);
    if (value !== null) return PNPM.test(value);
    if (ts.isConditionalExpression(inner)) {
      return (
        namesPnpm(inner.whenTrue, seen) || namesPnpm(inner.whenFalse, seen)
      );
    }
    if (ts.isIdentifier(inner) && !seen.has(inner.text)) {
      const initializer = consts.get(inner.text);
      if (!initializer) return false;
      seen.add(inner.text);
      return namesPnpm(initializer, seen);
    }
    if (
      ts.isCallExpression(inner) &&
      ts.isIdentifier(inner.expression) &&
      inner.arguments.length === 0 &&
      !seen.has(`${inner.expression.text}()`)
    ) {
      seen.add(`${inner.expression.text}()`);
      return (returns.get(inner.expression.text) ?? []).some((expression) =>
        namesPnpm(expression, seen),
      );
    }
    return false;
  };

  const setsShell = (call: ts.CallExpression): boolean =>
    call.arguments.slice(1).some((argument) => {
      let options = unwrap(argument);
      if (ts.isIdentifier(options)) {
        const initializer = consts.get(options.text);
        if (!initializer) return false;
        options = unwrap(initializer);
      }
      return (
        ts.isObjectLiteralExpression(options) &&
        options.properties.some(
          (property) =>
            (ts.isPropertyAssignment(property) ||
              ts.isShorthandPropertyAssignment(property)) &&
            property.name !== undefined &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            property.name.text === "shell",
        )
      );
    });

  const report = (node: ts.Node) => {
    const start =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
    const touched =
      addedLines === "all" ||
      [...addedLines].some((line) => line >= start && line <= end);
    const opted =
      lines.slice(start - 1, end).some((line) => PRAGMA.test(line)) ||
      PRAGMA_LINE.test(lines[start - 2] ?? "");
    if (touched && !opted) {
      findings.push({
        file,
        line: start,
        snippet: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 120),
      });
    }
  };

  // A shim literal in a spawn call's command is judged with the call, by its shell option.
  const inSpawnCommand = (literal: ts.Node): boolean => {
    for (let node = literal; node.parent; node = node.parent) {
      const parent = node.parent;
      if (ts.isCallExpression(parent)) {
        const name = calleeName(parent);
        return (
          name !== null && SPAWNERS.has(name) && parent.arguments[0] === node
        );
      }
      if (!ts.isExpression(parent)) return false;
    }
    return false;
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      const command = node.arguments[0];
      if (
        name !== null &&
        SPAWNERS.has(name) &&
        command !== undefined &&
        namesPnpm(command) &&
        !setsShell(node)
      ) {
        report(node);
      }
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      CMD_SHIM.test(node.text) &&
      !inSpawnCommand(node)
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function trackedSourceFiles(): Map<string, "all"> {
  const listed = execFileSync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return new Map(
    listed
      .split("\0")
      .filter(Boolean)
      .map((rel) => [path.join(rootDir, rel), "all" as const]),
  );
}

function main() {
  const scanAll = process.argv.includes("--all");
  const targets: Map<string, ReadonlySet<number> | "all"> = scanAll
    ? trackedSourceFiles()
    : requireAddedLines(rootDir, GUARD_NAME);

  let inspected = 0;
  const findings: BareSpawnFinding[] = [];
  for (const [absPath, lineNumbers] of targets) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isGuardedSourcePath(rel)) continue;

    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch (error) {
      if (scanAll) continue;
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    inspected += 1;
    findings.push(...findBarePnpmSpawns(rel, source, lineNumbers));
  }

  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${inspected} ${scanAll ? "" : "changed "}source file(s) inspected)`,
    );
    return;
  }

  console.error(
    `${GUARD_NAME}: ${findings.length} pnpm start(s) that fail on Windows.`,
  );
  console.error(
    "\nOn Windows pnpm is a pnpm.cmd shim, which Node starts only through a\n" +
      "shell: without one, spawning it fails with EINVAL or ENOENT. In a root\n" +
      "script, start pnpm with scripts/lib/pnpm-command.ts:\n\n" +
      '  const pnpm = pnpmCommand(["run", "build"]);\n' +
      "  spawn(pnpm.command, pnpm.args, { ...options, shell: pnpm.shell });\n\n" +
      'Elsewhere, pass shell: process.platform === "win32". A call that never\n' +
      "runs on Windows can say so on the call or the line above it:\n\n" +
      "  // guard:allow-bare-pnpm — <why>\n",
  );
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.snippet}`);
  }
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
