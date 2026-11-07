/**
 * guard-recursive-copy-links.ts
 *
 * `fs.cp` and `fs.cpSync` copy a symlink as a symlink by default, and rewrite
 * a relative link target as an absolute path unless `verbatimSymlinks` is
 * set. `agent-native upgrade` copied skill folders that way, so an app's
 * `.claude/skills` filled with links to paths on the machine that ran the
 * upgrade, which broke on every other machine once committed (issue #8231).
 *
 * This guard scans the published packages' source (`packages/<name>/src`,
 * not specs or tests) and flags a recursive `cp` or `cpSync` call that
 * doesn't choose what happens to links: `dereference: true` copies what a
 * link points at, and `verbatimSymlinks: true` keeps each link exactly as it
 * is (a whole-app copy, where following a link could pull in a file the copy
 * leaves out). Options the guard can't read, such as a variable, a spread, a
 * computed key or arguments spread into the call, count as recursive, and a
 * link choice counts only when it is written as `true`. A copier is found by
 * name, including `fs["cpSync"]` and a name the file gives it by import,
 * destructuring or assignment, as in `import { cpSync as copyTree } from
 * "node:fs"`, and also when it's called through `.call` or `.apply`.
 *
 * `dereference` also needs a `filter`. Without one, Node 24's `cpSync` takes
 * a native shortcut that follows only a link at the top of the copy and copies
 * the links inside it as links with absolute targets.
 *
 * A copy that really should write absolute links can say so, on any line of
 * the call or on the line immediately above it:
 *
 *   // guard:allow-copy-links — <why>
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const GUARD_NAME = "guard:recursive-copy-links";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-copy-links\b/;
// Above a call, the pragma must be the whole line, not another call's comment.
const PRAGMA_LINE = /^\s*(?:\/\/|\/\*)\s*guard:allow-copy-links\b/;
const PACKAGE_SOURCE = /^packages\/[^/]+\/src\/.+\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$|(?:^|\/)__tests__\//;
const SKIPPED = /(?:^|\/)(?:node_modules|dist|build)\//;
const COPIERS = new Set(["cp", "cpSync"]);
const LINK_CHOICES = new Set(["dereference", "verbatimSymlinks"]);

export interface CopyLinksFinding {
  file: string;
  line: number;
  snippet: string;
}

export function isGuardedSourcePath(relPath: string): boolean {
  return (
    PACKAGE_SOURCE.test(relPath) &&
    !TEST_FILE.test(relPath) &&
    !SKIPPED.test(relPath)
  );
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

// The member `fs.cpSync` or `fs["cpSync"]` names, when it's written out.
function memberName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function isCopier(callee: ts.Expression, names: Set<string>): boolean {
  const inner = unwrap(callee);
  if (ts.isIdentifier(inner)) return names.has(inner.text);
  const member = memberName(inner);
  return member !== undefined && COPIERS.has(member);
}

// Whether a call is a copy that leaves links to Node's default, also when
// it's made through `.call` or `.apply`.
function copyLeavesLinksToDefault(
  call: ts.CallExpression,
  names: Set<string>,
): boolean {
  const callee = unwrap(call.expression);
  if (isCopier(callee, names)) {
    return callLeavesLinksToDefault(call.arguments);
  }
  if (
    !(
      ts.isPropertyAccessExpression(callee) ||
      ts.isElementAccessExpression(callee)
    ) ||
    !isCopier(callee.expression, names)
  ) {
    return false;
  }
  const via = memberName(callee);
  if (via !== "call" && via !== "apply") return false;
  const [self, ...rest] = call.arguments;
  // A spread in place of `this` could hold the copy's arguments too.
  if (self !== undefined && ts.isSpreadElement(self)) return true;
  if (via === "call") return callLeavesLinksToDefault(rest);
  if (rest.length === 0) return false;
  const list = unwrap(rest[0]);
  // A list the guard can't read could hold any options.
  return (
    !ts.isArrayLiteralExpression(list) ||
    callLeavesLinksToDefault(list.elements)
  );
}

// `cp` and `cpSync`, plus any other name this file gives them, as in
// `import { cpSync as copyTree } from "node:fs"`,
// `const { cpSync: copyTree } = fs` or `const copyTree = fs.cpSync`.
function copierNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set(COPIERS);
  // `fs.cpSync`, a name already known, or either with `.bind(...)`.
  const isCopierValue = (value: ts.Expression): boolean => {
    const inner = unwrap(value);
    if (ts.isIdentifier(inner)) return names.has(inner.text);
    const member = memberName(inner);
    if (member !== undefined) return COPIERS.has(member);
    if (!ts.isCallExpression(inner)) return false;
    const callee = unwrap(inner.expression);
    return (
      (ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)) &&
      memberName(callee) === "bind" &&
      isCopierValue(callee.expression)
    );
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportSpecifier(node) || ts.isBindingElement(node)) &&
      node.propertyName &&
      (ts.isIdentifier(node.propertyName) ||
        ts.isStringLiteral(node.propertyName)) &&
      COPIERS.has(node.propertyName.text) &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCopierValue(node.initializer)
    ) {
      names.add(node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isCopierValue(node.right)
    ) {
      names.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  };
  // Repeated until no new name turns up, so an alias of a name assigned
  // further down the file is found too.
  let known: number;
  do {
    known = names.size;
    visit(sourceFile);
  } while (names.size !== known);
  return names;
}

// A property's name when it's written out: `recursive`, `"recursive"` or
// `["recursive"]`.
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const key = unwrap(name.expression);
    if (ts.isStringLiteralLike(key)) return key.text;
  }
  return undefined;
}

// Arguments spread into the call before the options could hold them, so
// they count as options the guard can't read.
function callLeavesLinksToDefault(args: readonly ts.Expression[]): boolean {
  const spread = args.findIndex((arg) => ts.isSpreadElement(arg));
  if (spread !== -1 && spread <= 2) return true;
  return args.length >= 2 && leavesLinksToDefault(args[2]);
}

/**
 * Whether a copy's options leave links to Node's default: copied as links,
 * with relative targets made absolute. A copy without options, or with
 * `recursive: false`, copies one file and is left alone.
 */
function leavesLinksToDefault(options: ts.Expression | undefined): boolean {
  if (!options) return false;
  const inner = unwrap(options);
  // `fs.cp(src, dest, callback)` has no options.
  if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) return false;
  if (!ts.isObjectLiteralExpression(inner)) return true;
  // Read in order, so a later property or spread wins.
  let recursive = false;
  let filtered = false;
  const chosen = new Set<string>();
  for (const property of inner.properties) {
    // A spread, or a key the guard can't read, could set any option.
    if (
      ts.isSpreadAssignment(property) ||
      (property.name !== undefined &&
        ts.isComputedPropertyName(property.name) &&
        propertyName(property.name) === undefined)
    ) {
      recursive = true;
      filtered = false;
      chosen.clear();
      continue;
    }
    if (
      ts.isMethodDeclaration(property) &&
      propertyName(property.name) === "filter"
    ) {
      filtered = true;
      continue;
    }
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      continue;
    }
    const name = propertyName(property.name);
    const valueIs = (kind: ts.SyntaxKind) =>
      ts.isPropertyAssignment(property) &&
      unwrap(property.initializer).kind === kind;
    const isFalse = valueIs(ts.SyntaxKind.FalseKeyword);
    if (name !== undefined && LINK_CHOICES.has(name)) {
      if (valueIs(ts.SyntaxKind.TrueKeyword)) chosen.add(name);
      else chosen.delete(name);
    }
    if (name === "recursive") recursive = !isFalse;
    // Like a link choice, a filter counts only when it's written here as a
    // function: a variable could be `undefined` when the copy runs.
    if (name === "filter") {
      const value = ts.isPropertyAssignment(property)
        ? unwrap(property.initializer)
        : undefined;
      filtered =
        value !== undefined &&
        (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
    }
  }
  const followsLinks = chosen.has("dereference") && filtered;
  return recursive && !followsLinks && !chosen.has("verbatimSymlinks");
}

export function findRecursiveCopies(
  file: string,
  source: string,
): CopyLinksFinding[] {
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
  const findings: CopyLinksFinding[] = [];
  const names = copierNames(sourceFile);

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && copyLeavesLinksToDefault(node, names)) {
      const start =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      const opted =
        lines.slice(start - 1, end).some((line) => PRAGMA.test(line)) ||
        PRAGMA_LINE.test(lines[start - 2] ?? "");
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

function trackedPackageFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--", "packages"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return listed.split("\0").filter(isGuardedSourcePath);
}

function main() {
  const files = trackedPackageFiles();
  const findings: CopyLinksFinding[] = [];
  for (const rel of files) {
    let source: string;
    try {
      source = readFileSync(path.join(rootDir, rel), "utf8");
    } catch {
      continue;
    }
    // Also matches `cpSync as copyTree`, whose calls don't say cp.
    if (!/\bcp(?:Sync)?\b/.test(source)) continue;
    findings.push(...findRecursiveCopies(rel, source));
  }

  if (findings.length === 0) {
    console.log(`${GUARD_NAME}: OK (${files.length} source file(s) inspected)`);
    return;
  }

  console.error(
    `${GUARD_NAME}: ${findings.length} recursive copy(ies) that leave symlinks to Node's default.`,
  );
  console.error(
    "\nBy default fs.cp and fs.cpSync copy a link as a link and make its target\n" +
      "absolute, so the copy only works on the machine that made it (#8231).\n" +
      "Choose what happens to links:\n\n" +
      "  fs.cpSync(src, dest, { recursive: true, dereference: true, filter: () => true });\n" +
      "  fs.cpSync(appDir, bundleDir, { recursive: true, verbatimSymlinks: true });\n\n" +
      "dereference needs a filter: without one, Node 24 follows only a link at\n" +
      "the top of the copy.\n\n" +
      "A copy that really should write absolute links can say so on the call or\n" +
      "the line above it:\n\n" +
      "  // guard:allow-copy-links — <why>\n",
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
