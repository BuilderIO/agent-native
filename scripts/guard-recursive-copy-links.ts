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
 * leaves out). Options the guard can't read, such as a variable or a spread,
 * count as recursive, and a link choice counts only when it is written as
 * `true`. A copier is found by name, including a name the file gives it on
 * import or destructuring, as in `import { cpSync as copyTree } from "node:fs"`.
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

function isCopier(call: ts.CallExpression, names: Set<string>): boolean {
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return names.has(callee.text);
  return ts.isPropertyAccessExpression(callee) && COPIERS.has(callee.name.text);
}

// `cp` and `cpSync`, plus any other name this file gives them, as in
// `import { cpSync as copyTree } from "node:fs"` or
// `const { cpSync: copyTree } = fs`.
function copierNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set(COPIERS);
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
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
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
    if (ts.isSpreadAssignment(property)) {
      recursive = true;
      filtered = false;
      chosen.clear();
      continue;
    }
    if (
      ts.isMethodDeclaration(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === "filter"
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
    const name =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : undefined;
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
    if (
      ts.isCallExpression(node) &&
      isCopier(node, names) &&
      node.arguments.length >= 2 &&
      leavesLinksToDefault(node.arguments[2])
    ) {
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
