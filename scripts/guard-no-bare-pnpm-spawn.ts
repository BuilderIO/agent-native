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
 * starts pnpm (or pnpx) without a shell on Windows. Root scripts start pnpm
 * through scripts/lib/pnpm-command.ts; elsewhere, pass
 * `shell: process.platform === "win32"` (or run the joined command line with
 * `shell: true` on Windows, as the helper does).
 *
 * The command is found on a best-effort basis: through literals, ternaries,
 * `??`/`||`/`&&` fallbacks, variables, destructuring, a local zero-argument
 * function, and `.command` of a `pnpmCommand(...)` result. The shell has to be
 * shown to be on: `true`, a shell path, `process.platform === "win32"`, the
 * helper's `.shell`, or a variable whose every value is one of those.
 * Variables are matched by name, not scope, which that rule keeps on the safe
 * side. Properties and spreads are read in order, so a later one wins, and a
 * spread the guard can't read counts as no shell. Spawners imported from
 * child_process under another name are checked too. It also flags a new
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
const LOGICAL_OPERATORS = new Set([
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
]);

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

/** `process.platform`, `os.platform()` or `platform()`. */
function isPlatform(node: ts.Expression): boolean {
  const inner = unwrap(node);
  if (ts.isPropertyAccessExpression(inner)) {
    return (
      inner.name.text === "platform" &&
      ts.isIdentifier(inner.expression) &&
      inner.expression.text === "process"
    );
  }
  return (
    ts.isCallExpression(inner) &&
    inner.arguments.length === 0 &&
    calleeName(inner) === "platform"
  );
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
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      // `const { command } = pnpmCommand(args)` gives `command` the value
      // `pnpmCommand(args).command`.
      for (const element of node.name.elements) {
        const key = element.propertyName ?? element.name;
        if (
          ts.isIdentifier(element.name) &&
          !element.dotDotDotToken &&
          ts.isIdentifier(key)
        ) {
          add(
            element.name.text,
            ts.factory.createPropertyAccessExpression(
              node.initializer,
              key.text,
            ),
          );
        }
      }
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

  // A `pnpmCommand(...)` call, directly or through a variable.
  const fromPnpmCommand = (node: ts.Expression): boolean => {
    const target = unwrap(node);
    const candidates = ts.isIdentifier(target)
      ? (values.get(target.text) ?? [])
      : [target];
    return candidates.some((candidate) => {
      const call = unwrap(candidate);
      return ts.isCallExpression(call) && calleeName(call) === "pnpmCommand";
    });
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
    // `process.env.PNPM_BIN ?? "pnpm"` and the like can pick either side.
    if (
      ts.isBinaryExpression(inner) &&
      LOGICAL_OPERATORS.has(inner.operatorToken.kind)
    ) {
      return namesPnpm(inner.left, seen) || namesPnpm(inner.right, seen);
    }
    // `pnpm.command` where `pnpm = pnpmCommand(...)`: the helper's Windows
    // command line, which needs its `shell` alongside it.
    if (ts.isPropertyAccessExpression(inner) && inner.name.text === "command") {
      return fromPnpmCommand(inner.expression);
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

  // A `shell` value that is on when it runs on Windows. Anything the guard
  // can't show is on counts as off. A variable needs every value of its name
  // to be on, since same-named variables in other scopes share one entry.
  const isShellOn = (
    node: ts.Expression,
    seen = new Set<string>(),
  ): boolean => {
    const inner = unwrap(node);
    if (inner.kind === ts.SyntaxKind.TrueKeyword) return true;
    const literal = literalValue(inner);
    if (literal !== null) return literal !== "";
    if (ts.isBinaryExpression(inner)) {
      const equals =
        inner.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        inner.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken;
      return (
        equals &&
        ((isPlatform(inner.left) && literalValue(inner.right) === "win32") ||
          (isPlatform(inner.right) && literalValue(inner.left) === "win32"))
      );
    }
    if (ts.isPropertyAccessExpression(inner) && inner.name.text === "shell") {
      return fromPnpmCommand(inner.expression);
    }
    if (!ts.isIdentifier(inner) || seen.has(inner.text)) return false;
    seen.add(inner.text);
    const assigned = values.get(inner.text) ?? [];
    return (
      assigned.length > 0 && assigned.every((value) => isShellOn(value, seen))
    );
  };

  const shellValue = (
    property: ts.ObjectLiteralElementLike,
  ): ts.Expression | undefined => {
    if (ts.isShorthandPropertyAssignment(property)) {
      return property.name.text === "shell" ? property.name : undefined;
    }
    return ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === "shell"
      ? property.initializer
      : undefined;
  };

  // What an options value leaves `shell` as, reading properties and spreads
  // in order so a later one wins. "unknown" is a value the guard can't read.
  type ShellSetting = "on" | "off" | "unset" | "unknown";
  const shellSetting = (
    node: ts.Expression,
    seen = new Set<string>(),
  ): ShellSetting => {
    const inner = unwrap(node);
    if (ts.isIdentifier(inner)) {
      if (seen.has(inner.text)) return "unknown";
      seen.add(inner.text);
      const settings = new Set(
        (values.get(inner.text) ?? []).map((value) =>
          shellSetting(value, seen),
        ),
      );
      return settings.size === 1 ? [...settings][0] : "unknown";
    }
    if (!ts.isObjectLiteralExpression(inner)) return "unknown";
    let setting: ShellSetting = "unset";
    for (const property of inner.properties) {
      if (ts.isSpreadAssignment(property)) {
        const spread = shellSetting(property.expression, seen);
        if (spread !== "unset") setting = spread;
        continue;
      }
      const value = shellValue(property);
      if (value !== undefined) setting = isShellOn(value) ? "on" : "off";
    }
    return setting;
  };

  const setsShell = (call: ts.CallExpression): boolean =>
    call.arguments.slice(1).some((argument) => shellSetting(argument) === "on");

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
