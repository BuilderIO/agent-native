/**
 * guard-action-output-schema.ts
 *
 * `outputSchema` is what makes an action's result a contract: `defineAction`
 * validates every result against it (strictly, by default), types the
 * action's return from it, and lets MCP advertise it. Without one, a result
 * the UI, the agent, and external callers all read is whatever the handler
 * happened to return, and a shape drift reaches them as a confident wrong
 * value instead of a failure. When this guard landed, 24 of the repo's ~1,340
 * template and package action files declared one.
 *
 * This guard scans only `defineAction({...})` calls whose opening line this
 * branch ADDED (via scripts/lib/changed-lines.mjs), so a new action needs an
 * `outputSchema` while editing an existing one does not. It also rejects
 * `outputErrorStrategy: "fallback"` added to any action: a fallback hides a
 * broken result behind a plausible one, which is the coercion CLAUDE.md bans.
 *
 * The guard fails closed: options it cannot read as an object literal
 * declaring `outputSchema` with a real value count as missing. That covers a
 * spread, a variable passed as the options, `outputSchema: undefined`, and an
 * identifier (shorthand included) that does not resolve, within the file, to
 * an import or a declaration with a value. Calls through a namespace
 * (`core.defineAction`) or an aliased import are recognized as actions. An
 * added `outputErrorStrategy` must be a string literal or a `const` that
 * resolves to one, and never `"fallback"`. An action whose result genuinely has no stable shape (a raw
 * provider passthrough), or whose schema comes from a spread the guard cannot
 * see through, says so on the `defineAction(` line or the line above it:
 *
 *   // guard:allow-no-output-schema — <why the result has no fixed shape>
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:action-output-schema";
const rootDir = path.resolve(import.meta.dirname, "..");

const PRAGMA = /(?:\/\/|\/\*)\s*guard:allow-no-output-schema\b/;
const IN_SCOPE = /^(?:templates|community-templates|apps|packages)\//;
const SKIPPED =
  /(\.spec\.|\.test\.|\.test-d\.|\/__tests__\/|\/e2e\/|\/dist\/|\/node_modules\/|\.d\.ts$)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;

export interface OutputSchemaFinding {
  file: string;
  line: number;
  problem:
    | "missing-output-schema"
    | "fallback-strategy"
    | "non-literal-strategy";
}

/** Local names bound to `defineAction`, aliased imports included. */
function defineActionNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set(["defineAction"]);
  for (const statement of sourceFile.statements) {
    const bindings =
      ts.isImportDeclaration(statement) &&
      statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === "defineAction") {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

// ponytail: bindings resolve by name across the file, not by scope; a
// shadowed name can resolve to the wrong declaration.
function declarationsNamed(sourceFile: ts.SourceFile, name: string): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isParameter(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const isUndefinedValue = (value: ts.Expression) =>
  (ts.isIdentifier(value) && value.text === "undefined") ||
  ts.isVoidExpression(value);

/** Whether an expression provably holds a value, not `undefined`. */
function hasValue(
  value: ts.Expression,
  sourceFile: ts.SourceFile,
  depth = 0,
): boolean {
  if (isUndefinedValue(value)) return false;
  if (!ts.isIdentifier(value)) return true;
  const declarations = declarationsNamed(sourceFile, value.text);
  return (
    depth < 5 &&
    declarations.length > 0 &&
    declarations.every((declaration) =>
      ts.isVariableDeclaration(declaration)
        ? declaration.initializer !== undefined &&
          hasValue(declaration.initializer, sourceFile, depth + 1)
        : !ts.isParameter(declaration),
    )
  );
}

/** A string an expression is statically known to be, if any. */
function staticString(
  value: ts.Expression,
  sourceFile: ts.SourceFile,
  depth = 0,
): string | null {
  if (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) {
    return staticString(value.expression, sourceFile, depth);
  }
  if (ts.isStringLiteralLike(value)) return value.text;
  if (!ts.isIdentifier(value) || depth >= 5) return null;
  const [declaration, ...rest] = declarationsNamed(sourceFile, value.text);
  return declaration &&
    rest.length === 0 &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer &&
    ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const
    ? staticString(declaration.initializer, sourceFile, depth + 1)
    : null;
}

function optionValue(
  property: ts.ObjectLiteralElementLike,
): ts.Expression | null {
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return null;
}

/** Whether a literal option declares an `outputSchema` with a real value. */
function declaresOutputSchema(
  options: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): boolean {
  return options.properties.some((property) => {
    if (propertyName(property) !== "outputSchema") return false;
    const value = optionValue(property);
    return value !== null && hasValue(value, sourceFile);
  });
}

export function isCheckedSourcePath(relPath: string): boolean {
  return (
    IN_SCOPE.test(relPath) &&
    SOURCE_FILE.test(relPath) &&
    !SKIPPED.test(relPath)
  );
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    (ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }
  return null;
}

export function findOutputSchemaProblems(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): OutputSchemaFinding[] {
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const lines = source.split(/\r?\n/);
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;
  const findings: OutputSchemaFinding[] = [];
  const names = defineActionNames(sourceFile);
  const isDefineActionCallee = (callee: ts.Expression) =>
    ts.isIdentifier(callee)
      ? names.has(callee.text)
      : ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "defineAction";

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isDefineActionCallee(node.expression)) {
      const options = node.arguments[0];
      const literal =
        options && ts.isObjectLiteralExpression(options) ? options : undefined;
      const line = lineOf(node);
      const opted =
        PRAGMA.test(lines[line - 1] ?? "") ||
        PRAGMA.test(lines[line - 2] ?? "");
      if (
        addedLines.has(line) &&
        !(literal && declaresOutputSchema(literal, sourceFile)) &&
        !opted
      ) {
        findings.push({ file, line, problem: "missing-output-schema" });
      }
      for (const property of literal?.properties ?? []) {
        const value = optionValue(property);
        if (
          propertyName(property) !== "outputErrorStrategy" ||
          !value ||
          !addedLines.has(lineOf(property))
        ) {
          continue;
        }
        const strategy = staticString(value, sourceFile);
        if (strategy === null || strategy === "fallback") {
          findings.push({
            file,
            line: lineOf(property),
            problem:
              strategy === null ? "non-literal-strategy" : "fallback-strategy",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function main() {
  const added = requireAddedLines(rootDir, GUARD_NAME);

  let inspected = 0;
  const findings: OutputSchemaFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isCheckedSourcePath(rel)) continue;

    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    if (!source.includes("defineAction")) continue;
    inspected += 1;
    findings.push(...findOutputSchemaProblems(rel, source, lineNumbers));
  }

  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${inspected} changed file(s) defining actions inspected)`,
    );
    return;
  }

  console.error(`${GUARD_NAME}: ${findings.length} problem(s) in new actions.`);
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line} — ${
        {
          "missing-output-schema":
            "new defineAction() has no readable outputSchema",
          "fallback-strategy": 'outputErrorStrategy: "fallback" is deprecated',
          "non-literal-strategy":
            "outputErrorStrategy must be a string literal the guard can read",
        }[finding.problem]
      }`,
    );
  }
  console.error(
    "\nDeclare what the action returns; the action's return type is then\n" +
      "inferred from it and every result is validated strictly:\n\n" +
      "  outputSchema: z.object({ id: z.string(), title: z.string() }),\n\n" +
      'Drop `outputErrorStrategy: "fallback"`: fix the result or let the\n' +
      "strict default fail loudly. A result with no fixed shape says why on\n" +
      "the defineAction( line or the line above:\n" +
      "  // guard:allow-no-output-schema — <why>\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
