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
 * guard parses every tracked and untracked source file that names the module
 * and rejects each of those outside build-server.ts and the module's own spec.
 * Any call that names the module by a literal string counts, so
 * `createRequire(...)("./execute-action-call")` and `vi.importActual(...)` are
 * caught too. A specifier computed at runtime cannot be checked.
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
const MENTIONS_MODULE = "execute-action-call";

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
    ["grep", "-l", "-z", "-F", "--untracked", MENTIONS_MODULE],
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
