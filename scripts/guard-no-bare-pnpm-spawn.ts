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
 * `shell: true` on Windows, as the helper does); `shell: false` counts as no
 * shell, and so does a variable that is only ever `false`. Spawners imported
 * from child_process under another name are checked
 * too, and so is `pnpm.command` from a `pnpmCommand(...)` result passed without
 * its `shell`. It also flags a new
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
const CHILD_PROCESS = /^(?:node:)?child_process$/;

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

/** `require("node:child_process")` or `await import("node:child_process")`. */
function loadsChildProcess(node: ts.Expression): boolean {
  let inner = unwrap(node);
  if (ts.isAwaitExpression(inner)) inner = unwrap(inner.expression);
  if (!ts.isCallExpression(inner) || inner.arguments.length !== 1) return false;
  const loader =
    inner.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(inner.expression) && inner.expression.text === "require");
  const specifier = literalValue(inner.arguments[0]);
  return loader && specifier !== null && CHILD_PROCESS.test(specifier);
}

/**
 * Spawners the file takes from child_process, by local name, so
 * `import { spawn as launch }` and `const { spawn: launch } = require(...)`
 * are checked like `spawn`.
 */
function spawnerAliases(sourceFile: ts.SourceFile) {
  const aliases = new Map<string, string>();
  const add = (local: ts.Node, imported: ts.Node | undefined) => {
    const from = imported ?? local;
    if (
      ts.isIdentifier(local) &&
      (ts.isIdentifier(from) || ts.isStringLiteral(from)) &&
      SPAWNERS.has(from.text)
    ) {
      aliases.set(local.text, from.text);
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      CHILD_PROCESS.test(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        add(element.name, element.propertyName);
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      loadsChildProcess(node.initializer)
    ) {
      for (const element of node.name.elements) {
        add(element.name, element.propertyName);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

/**
 * Every value the file gives each variable name: its initializer and any
 * later `name = <value>` assignment, for `const`, `let` and `var` alike.
 */
function variableValues(sourceFile: ts.SourceFile) {
  const found = new Map<string, ts.Expression[]>();
  const add = (name: string, value: ts.Expression) => {
    found.set(name, [...(found.get(name) ?? []), value]);
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      add(node.name.text, node.initializer);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      add(node.left.text, node.right);
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
  const values = variableValues(sourceFile);
  const returns = functionReturns(sourceFile);
  const aliases = spawnerAliases(sourceFile);
  const findings: BareSpawnFinding[] = [];

  const spawnerName = (call: ts.CallExpression): string | null => {
    const name = calleeName(call);
    if (name === null) return null;
    const resolved = ts.isIdentifier(unwrap(call.expression))
      ? (aliases.get(name) ?? name)
      : name;
    return SPAWNERS.has(resolved) ? resolved : null;
  };

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
    // `pnpm.command` where `pnpm = pnpmCommand(...)`: the helper's Windows
    // command line, which needs its `shell` alongside it.
    if (ts.isPropertyAccessExpression(inner) && inner.name.text === "command") {
      const target = unwrap(inner.expression);
      const candidates = ts.isIdentifier(target)
        ? (values.get(target.text) ?? [])
        : [target];
      return candidates.some((candidate) => {
        const call = unwrap(candidate);
        return ts.isCallExpression(call) && calleeName(call) === "pnpmCommand";
      });
    }
    if (ts.isIdentifier(inner) && !seen.has(inner.text)) {
      seen.add(inner.text);
      return (values.get(inner.text) ?? []).some((value) =>
        namesPnpm(value, seen),
      );
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

  // `false`, `null` or `undefined`, directly or through a variable that only
  // ever holds one of them.
  const isNoShell = (
    node: ts.Expression,
    seen = new Set<string>(),
  ): boolean => {
    const inner = unwrap(node);
    if (
      inner.kind === ts.SyntaxKind.FalseKeyword ||
      inner.kind === ts.SyntaxKind.NullKeyword
    ) {
      return true;
    }
    if (!ts.isIdentifier(inner) || seen.has(inner.text)) return false;
    seen.add(inner.text);
    const assigned = values.get(inner.text) ?? [];
    if (assigned.length === 0) return inner.text === "undefined";
    return assigned.every((value) => isNoShell(value, seen));
  };

  const enablesShell = (options: ts.Expression): boolean =>
    ts.isObjectLiteralExpression(options) &&
    options.properties.some((property) => {
      if (ts.isShorthandPropertyAssignment(property)) {
        return property.name.text === "shell" && !isNoShell(property.name);
      }
      return (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "shell" &&
        !isNoShell(property.initializer)
      );
    });

  const setsShell = (call: ts.CallExpression): boolean =>
    call.arguments.slice(1).some((argument) => {
      const options = unwrap(argument);
      if (!ts.isIdentifier(options)) return enablesShell(options);
      return (values.get(options.text) ?? []).some((value) =>
        enablesShell(unwrap(value)),
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
        return spawnerName(parent) !== null && parent.arguments[0] === node;
      }
      if (!ts.isExpression(parent)) return false;
    }
    return false;
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const command = node.arguments[0];
      if (
        spawnerName(node) !== null &&
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
