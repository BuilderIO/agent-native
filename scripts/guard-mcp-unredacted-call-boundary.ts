/**
 * guard-mcp-unredacted-call-boundary.ts
 *
 * `runMcpActionCallUnredacted` in packages/core/src/mcp/execute-action-call.ts
 * returns raw action results and approval state, embed tickets included.
 * Everything except the direct tools/call adapter calls `executeMcpActionCall`,
 * which redacts.
 *
 * The rule is structural, so it does not need to follow a value through
 * aliases:
 *
 * - Only the files in UNREDACTED_IMPORTERS may load the unredacted call: the
 *   dedicated direct adapter, direct-action-call.ts, and the module's spec.
 * - Each of them may export only the function declarations listed for it. Any
 *   other export fails, whatever it holds, so the raw function cannot leave
 *   under another name, through an object, or behind a condition.
 * - Only the files in DIRECT_ADAPTER_IMPORTERS may load the direct adapter.
 * - No file may re-export the unredacted call or the direct adapter.
 *
 * A load is an import that binds a value (named, default, namespace or
 * `import x = require()`), or any call that names the module by a literal
 * string, so `import()`, `require`, `createRequire(...)(...)` and
 * `vi.importActual` count. A module name counts however the string spells it.
 * The guard cannot see a specifier computed at runtime, or what an allowed
 * export does with the function inside its body. That is why the direct
 * adapter is its own small module, where review can see the whole of it.
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
export const DIRECT_ADAPTER = "packages/core/src/mcp/direct-action-call.ts";

/**
 * The only files that may load the unredacted call, each with the only values
 * it may export: function declarations with these names.
 */
export const UNREDACTED_IMPORTERS: Readonly<Record<string, readonly string[]>> =
  {
    [DIRECT_ADAPTER]: ["createDirectActionCall"],
    "packages/core/src/mcp/execute-action-call.spec.ts": [],
  };

/** The only files that may load the direct adapter. */
export const DIRECT_ADAPTER_IMPORTERS: readonly string[] = [
  "packages/core/src/mcp/build-server.ts",
];

interface Boundary {
  file: string;
  /** The file's name without its extension, as a specifier spells it. */
  module: string;
  /** The one export it guards; every value export when absent. */
  guarded?: string;
  importers: readonly string[];
}

const BOUNDARIES: readonly Boundary[] = [
  {
    file: PROTECTED_MODULE,
    module: "execute-action-call",
    guarded: PROTECTED_EXPORT,
    importers: Object.keys(UNREDACTED_IMPORTERS),
  },
  {
    file: DIRECT_ADAPTER,
    module: "direct-action-call",
    importers: DIRECT_ADAPTER_IMPORTERS,
  },
];

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

function namesModule(node: ts.Node | undefined, boundary: Boundary): boolean {
  if (
    node === undefined ||
    !(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return false;
  }
  const name = node.text
    .split("?")[0]
    .split(/[/\\]/)
    .pop()
    ?.replace(/\.[cm]?[jt]s$/, "");
  return name === boundary.module;
}

function bindsGuarded(
  elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>,
  boundary: Boundary,
): boolean {
  return elements.some(
    (element) =>
      !element.isTypeOnly &&
      (boundary.guarded === undefined ||
        (element.propertyName ?? element.name).text === boundary.guarded),
  );
}

/** A default import binds the whole module under CommonJS interop. */
function importBindsGuarded(
  node: ts.ImportDeclaration,
  boundary: Boundary,
): boolean {
  const clause = node.importClause;
  if (!clause || clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  return (
    clause.name !== undefined ||
    (bindings !== undefined &&
      (ts.isNamespaceImport(bindings) ||
        bindsGuarded(bindings.elements, boundary)))
  );
}

function reExportsGuarded(
  node: ts.ExportDeclaration,
  boundary: Boundary,
): boolean {
  if (node.isTypeOnly) return false;
  const clause = node.exportClause;
  return (
    !clause ||
    ts.isNamespaceExport(clause) ||
    bindsGuarded(clause.elements, boundary)
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? boundNames(element.name) : [],
  );
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
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

/**
 * The names of the values `node` exports from its file. Interfaces and type
 * aliases carry no value, so they are not exports here.
 */
function valueExports(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)) &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword)
  ) {
    if (ts.isImportEqualsDeclaration(node) && node.isTypeOnly) return [];
    return [
      hasModifier(node, ts.SyntaxKind.DefaultKeyword) || !node.name
        ? "default"
        : node.name.getText(sourceFile),
    ];
  }
  if (
    ts.isVariableStatement(node) &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword)
  ) {
    return node.declarationList.declarations.flatMap((declaration) =>
      boundNames(declaration.name),
    );
  }
  if (ts.isExportAssignment(node)) {
    return [node.isExportEquals ? "export =" : "default"];
  }
  if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
    const clause = node.exportClause;
    if (!clause) return ["*"];
    if (ts.isNamespaceExport(clause)) return [clause.name.text];
    return clause.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => element.name.text);
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    isCommonJsExportTarget(node.left)
  ) {
    return [node.left.getText(sourceFile)];
  }
  return [];
}

function describeLoad(node: ts.CallExpression, module: string): string {
  const callee = node.expression;
  if (callee.kind === ts.SyntaxKind.ImportKeyword) {
    return `dynamic import() of ${module}`;
  }
  if (ts.isIdentifier(callee) && callee.text === "require") {
    return `require() of ${module}`;
  }
  return `call that loads ${module} by name`;
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
  const exportAllowlist = Object.hasOwn(UNREDACTED_IMPORTERS, file)
    ? UNREDACTED_IMPORTERS[file]
    : undefined;
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
    for (const boundary of BOUNDARIES) {
      if (file === boundary.file) continue;
      const mayLoad = boundary.importers.includes(file);
      if (
        ts.isImportDeclaration(node) &&
        namesModule(node.moduleSpecifier, boundary)
      ) {
        if (!mayLoad && importBindsGuarded(node, boundary)) {
          report(node, `import of ${boundary.module}`);
        }
      } else if (
        ts.isExportDeclaration(node) &&
        namesModule(node.moduleSpecifier, boundary)
      ) {
        if (reExportsGuarded(node, boundary)) {
          report(node, `re-export of ${boundary.module}`);
        }
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        ts.isExternalModuleReference(node.moduleReference) &&
        namesModule(node.moduleReference.expression, boundary)
      ) {
        if (!mayLoad)
          report(node, `import-equals require of ${boundary.module}`);
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.some((argument) => namesModule(argument, boundary))
      ) {
        if (!mayLoad) report(node, describeLoad(node, boundary.module));
      }
    }
    if (exportAllowlist) {
      for (const name of valueExports(node, sourceFile)) {
        if (!exportAllowlist.includes(name)) {
          report(node, `export not on the allowlist: ${name}`);
        } else if (
          !ts.isFunctionDeclaration(node) ||
          hasModifier(node, ts.SyntaxKind.DefaultKeyword)
        ) {
          report(node, `${name} exported other than as a function declaration`);
        }
      }
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
      ...BOUNDARIES.flatMap(({ module }) => ["-e", spelledAnyWay(module)]),
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
  // An allowlisted file's exports are checked whatever it mentions.
  const toParse = new Set([
    ...mentioned.stdout.split("\0"),
    ...Object.keys(UNREDACTED_IMPORTERS),
  ]);
  const findings: BoundaryFinding[] = [];
  for (const file of toParse) {
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
      `embed tickets included. Only ${DIRECT_ADAPTER}\n` +
      `may load it, it may export only ${UNREDACTED_IMPORTERS[DIRECT_ADAPTER].join(", ")},\n` +
      `and only ${DIRECT_ADAPTER_IMPORTERS.join(", ")} may load that.\n` +
      "Call executeMcpActionCall instead; it applies the same authorization and\n" +
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
