/**
 * guard-mcp-unredacted-call-boundary.ts
 *
 * `runMcpActionCallUnredacted` in packages/core/src/mcp/execute-action-call.ts
 * returns raw action results and approval state, embed tickets included. Only
 * the direct tools/call adapter in build-server.ts may call it; everything else
 * goes through `executeMcpActionCall`, which redacts.
 *
 * oxlint's no-restricted-imports covers a static named import. It cannot see a
 * dynamic `import()`, a `require`, a namespace import, an `import x =
 * require()`, or a re-export, and it does not lint spec files or scripts. This
 * guard parses every tracked and untracked source file that names the module,
 * however its string spells the name, and rejects each of those outside
 * build-server.ts and the module's own spec. Any call that names the module by
 * a literal string counts, so `createRequire(...)("./execute-action-call")`
 * and `vi.importActual(...)` are caught too. No file, allowed importers
 * included, may export what it imported: `export { alias }`, `export default`,
 * `export =`, an exported or `module.exports` value, or an object or array
 * holding it. A specifier computed at runtime, and an exported function that
 * calls the protected one, cannot be checked.
 *
 * Exit codes follow run-guards.ts: 0 passed, 1 a bypass was found, 2 the guard
 * could not run (git failed, no source files were listed, or the module it
 * protects is missing), because a pass that inspected nothing is not a pass.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { GUARD_EXIT_COULD_NOT_RUN } from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:mcp-unredacted-call-boundary";
const rootDir = path.resolve(import.meta.dirname, "..");

export const PROTECTED_MODULE = "packages/core/src/mcp/execute-action-call.ts";
export const PROTECTED_EXPORT = "runMcpActionCallUnredacted";
const PROTECTED_SPECIFIER = /(^|\/)execute-action-call(\.[cm]?[jt]s)?$/;
const MODULE_NAME = "execute-action-call";

const ALLOWED_IMPORTERS = new Set([
  "packages/core/src/mcp/build-server.ts",
  "packages/core/src/mcp/execute-action-call.spec.ts",
  PROTECTED_MODULE,
]);

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const SKIPPED = /(^|\/)(node_modules|dist|build|\.output)\//;

export interface BoundaryFinding {
  file: string;
  line: number;
  kind: string;
  snippet: string;
}

export type BoundaryCheck =
  | { status: "passed"; inspected: number }
  | { status: "failed"; inspected: number; findings: BoundaryFinding[] }
  | { status: "could-not-run"; reason: string };

function namesProtectedModule(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    PROTECTED_SPECIFIER.test(node.text)
  );
}

function bindsProtectedExport(
  elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>,
): boolean {
  return elements.some(
    (element) =>
      !element.isTypeOnly &&
      (element.propertyName ?? element.name).text === PROTECTED_EXPORT,
  );
}

function loadsProtectedModule(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    node.arguments.some((argument) => namesProtectedModule(argument))
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Top-level names that hold the protected function or its whole module: an
 * import of either, a loaded module, and any `const` copied from one. An
 * allowed importer may call them but not export them.
 */
function protectedHandles(sourceFile: ts.SourceFile): Set<string> {
  const handles = new Set<string>();
  const add = (name: string) => {
    if (handles.has(name)) return false;
    handles.add(name);
    return true;
  };
  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      namesProtectedModule(statement.moduleSpecifier) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly
    ) {
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (
            !element.isTypeOnly &&
            (element.propertyName ?? element.name).text === PROTECTED_EXPORT
          ) {
            add(element.name.text);
          }
        }
      }
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      namesProtectedModule(statement.moduleReference.expression)
    ) {
      add(statement.name.text);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (!initializer || !holdsProtected(initializer, handles)) continue;
        if (ts.isIdentifier(declaration.name)) {
          grew = add(declaration.name.text) || grew;
          continue;
        }
        const fromArray = ts.isArrayBindingPattern(declaration.name);
        for (const element of declaration.name.elements) {
          if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) {
            continue;
          }
          const key = element.propertyName ?? element.name;
          if (
            fromArray ||
            element.dotDotDotToken ||
            mayNameProtectedExport(key)
          ) {
            grew = add(element.name.text) || grew;
          }
        }
      }
    }
  }
  return handles;
}

/** A computed key may be the protected name, so it counts. */
function mayNameProtectedExport(key: ts.Node): boolean {
  if (ts.isComputedPropertyName(key)) return true;
  if (ts.isElementAccessExpression(key)) {
    const argument = key.argumentExpression;
    return (
      !ts.isStringLiteralLike(argument) || argument.text === PROTECTED_EXPORT
    );
  }
  return (
    (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) &&
    key.text === PROTECTED_EXPORT
  );
}

/** Whether a value expression is, or directly contains, a protected handle. */
function holdsProtected(node: ts.Expression, handles: Set<string>): boolean {
  const value = unwrap(node);
  if (ts.isIdentifier(value)) return handles.has(value.text);
  if (loadsProtectedModule(value)) return true;
  if (ts.isPropertyAccessExpression(value)) {
    return (
      mayNameProtectedExport(value.name) &&
      holdsProtected(value.expression, handles)
    );
  }
  if (ts.isElementAccessExpression(value)) {
    return (
      mayNameProtectedExport(value) && holdsProtected(value.expression, handles)
    );
  }
  if (ts.isCallExpression(value)) {
    const callee = unwrap(value.expression);
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "bind" &&
      holdsProtected(callee.expression, handles)
    );
  }
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.some(
      (element) =>
        !ts.isOmittedExpression(element) &&
        holdsProtected(
          ts.isSpreadElement(element) ? element.expression : element,
          handles,
        ),
    );
  }
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.some((property) =>
      ts.isPropertyAssignment(property)
        ? holdsProtected(property.initializer, handles)
        : ts.isShorthandPropertyAssignment(property)
          ? handles.has(property.name.text)
          : ts.isSpreadAssignment(property) &&
            holdsProtected(property.expression, handles),
    );
  }
  return false;
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
}

function isCommonJsExportTarget(node: ts.Expression): boolean {
  let current = unwrap(node);
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    if (
      ts.isIdentifier(current.expression) &&
      current.expression.text === "module" &&
      ts.isPropertyAccessExpression(current) &&
      current.name.text === "exports"
    ) {
      return true;
    }
    current = unwrap(current.expression);
  }
  return ts.isIdentifier(current) && current.text === "exports";
}

export function findBoundaryBypasses(
  file: string,
  source: string,
): BoundaryFinding[] {
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
  const importerAllowed = ALLOWED_IMPORTERS.has(file);
  const handles = protectedHandles(sourceFile);
  const findings: BoundaryFinding[] = [];
  const report = (node: ts.Node, findingKind: string) => {
    findings.push({
      file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      kind: findingKind,
      snippet: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 120),
    });
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      namesProtectedModule(node.moduleSpecifier) &&
      !importerAllowed
    ) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (clause && !clause.isTypeOnly && bindings) {
        if (ts.isNamespaceImport(bindings)) {
          report(node, "namespace import");
        } else if (bindsProtectedExport(bindings.elements)) {
          report(node, `named import of ${PROTECTED_EXPORT}`);
        }
      }
    } else if (
      ts.isExportDeclaration(node) &&
      namesProtectedModule(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      const clause = node.exportClause;
      if (!clause || ts.isNamespaceExport(clause)) {
        report(node, "re-export of the whole module");
      } else if (bindsProtectedExport(clause.elements)) {
        report(node, `re-export of ${PROTECTED_EXPORT}`);
      }
    } else if (
      ts.isExportDeclaration(node) &&
      !node.moduleSpecifier &&
      !node.isTypeOnly &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some(
        (element) =>
          !element.isTypeOnly &&
          handles.has((element.propertyName ?? element.name).text),
      )
    ) {
      report(node, `local export of ${PROTECTED_EXPORT}`);
    } else if (
      ts.isExportAssignment(node) &&
      holdsProtected(node.expression, handles)
    ) {
      report(node, `default export of ${PROTECTED_EXPORT}`);
    } else if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) &&
      node.declarationList.declarations.some((declaration) =>
        boundNames(declaration.name).some((name) => handles.has(name)),
      )
    ) {
      report(node, `exported value holding ${PROTECTED_EXPORT}`);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isCommonJsExportTarget(node.left) &&
      holdsProtected(node.right, handles)
    ) {
      report(node, `CommonJS export of ${PROTECTED_EXPORT}`);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference) &&
      namesProtectedModule(node.moduleReference.expression) &&
      !importerAllowed
    ) {
      report(node, "import-equals require");
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.some((argument) => namesProtectedModule(argument)) &&
      !importerAllowed
    ) {
      const callee = node.expression;
      report(
        node,
        callee.kind === ts.SyntaxKind.ImportKeyword
          ? "dynamic import()"
          : ts.isIdentifier(callee) && callee.text === "require"
            ? "require()"
            : "call that loads the module by name",
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

/**
 * An extended regular expression for every way a string literal can spell
 * `text` on one line. Each character may be itself, an identity escape
 * (`\-`), a hex, Unicode or code point escape, or a legacy octal escape, so a
 * plain search for the module name misses `"./execute\x2daction-call.js"`,
 * which still loads it.
 */
export function spelledAnyWay(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) as number;
      const hex = (width: number) =>
        code
          .toString(16)
          .padStart(width, "0")
          .replace(/[a-f]/g, (digit) => `[${digit}${digit.toUpperCase()}]`);
      const literal = char.replace(/[.[\]()*+?{}|^$\\]/g, "\\$&");
      return `(${literal}|\\\\${literal}|\\\\x${hex(2)}|\\\\u${hex(4)}|\\\\u[{]0*${hex(1)}[}]|\\\\0*${code.toString(8)})`;
    })
    .join("");
}

// A backslash before a line break continues a string on the next line, which
// a line-based search cannot follow, so a file with one is always parsed.
const LINE_CONTINUATION = "\\\\(\r|$|\u2028|\u2029)";

function listSourceFiles(root: string): string[] | { error: string } {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (listed.error || listed.status !== 0) {
    return {
      error:
        listed.error?.message ??
        (listed.stderr.trim() || `git ls-files exited ${listed.status}`),
    };
  }
  return listed.stdout
    .split("\0")
    .filter((file) => SOURCE_FILE.test(file) && !SKIPPED.test(file));
}

export function checkBoundary(root: string): BoundaryCheck {
  const files = listSourceFiles(root);
  if (!Array.isArray(files)) {
    return {
      status: "could-not-run",
      reason: `could not list source files: ${files.error}`,
    };
  }
  if (files.length === 0) {
    return { status: "could-not-run", reason: "git listed no source files" };
  }
  const protectedPath = path.join(root, PROTECTED_MODULE);
  if (
    !existsSync(protectedPath) ||
    !new RegExp(`export\\s+async\\s+function\\s+${PROTECTED_EXPORT}\\b`).test(
      readFileSync(protectedPath, "utf8"),
    )
  ) {
    return {
      status: "could-not-run",
      reason: `${PROTECTED_MODULE} no longer exports ${PROTECTED_EXPORT}; update this guard to protect whatever replaced it`,
    };
  }

  // git grep exits 1 for "no file matched", which is a clean result here, and
  // above 1 when it failed.
  const mentioned = spawnSync(
    "git",
    [
      "grep",
      "-l",
      "-z",
      "-E",
      "--untracked",
      "-e",
      spelledAnyWay(MODULE_NAME),
      "-e",
      LINE_CONTINUATION,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (mentioned.error || (mentioned.status !== 0 && mentioned.status !== 1)) {
    return {
      status: "could-not-run",
      reason: `could not search source files: ${
        mentioned.error?.message ??
        (mentioned.stderr.trim() || `git grep exited ${mentioned.status}`)
      }`,
    };
  }
  const sourceFiles = new Set(files);
  const findings: BoundaryFinding[] = [];
  for (const file of mentioned.stdout.split("\0")) {
    if (!sourceFiles.has(file)) continue;
    let source: string;
    try {
      source = readFileSync(path.join(root, file), "utf8");
    } catch (error) {
      return {
        status: "could-not-run",
        reason: `could not read ${file}: ${(error as Error).message}`,
      };
    }
    findings.push(...findBoundaryBypasses(file, source));
  }
  return findings.length === 0
    ? { status: "passed", inspected: files.length }
    : { status: "failed", inspected: files.length, findings };
}

function main() {
  const result = checkBoundary(rootDir);
  if (result.status === "could-not-run") {
    console.error(`${GUARD_NAME}: could not run: ${result.reason}`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
  if (result.status === "passed") {
    console.log(
      `${GUARD_NAME}: OK (${result.inspected} source file(s) inspected)`,
    );
    return;
  }
  console.error(
    `${GUARD_NAME}: ${result.findings.length} way(s) around the unredacted MCP action call boundary.`,
  );
  for (const finding of result.findings) {
    console.error(
      `  ${finding.file}:${finding.line} — ${finding.kind}: ${finding.snippet}`,
    );
  }
  console.error(
    `\n${PROTECTED_EXPORT} returns raw action results and approval state,\n` +
      "embed tickets included. Only the direct tools/call adapter in\n" +
      "packages/core/src/mcp/build-server.ts may load it. Call\n" +
      "executeMcpActionCall instead; it applies the same authorization and\n" +
      "approval, and returns a redacted outcome.\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
