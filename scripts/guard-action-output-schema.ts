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
 * An object spread in the options counts as declaring it, because the guard
 * cannot see through it. An action whose result genuinely has no stable shape
 * (a raw provider passthrough) says so on the `defineAction(` line or the
 * line above it:
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
  problem: "missing-output-schema" | "fallback-strategy";
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

  const visit = (node: ts.Node) => {
    const options = ts.isCallExpression(node) ? node.arguments[0] : undefined;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineAction" &&
      options &&
      ts.isObjectLiteralExpression(options)
    ) {
      const line = lineOf(node);
      const names = new Set(options.properties.map(propertyName));
      const spreads = options.properties.some(ts.isSpreadAssignment);
      const opted =
        PRAGMA.test(lines[line - 1] ?? "") ||
        PRAGMA.test(lines[line - 2] ?? "");
      if (
        addedLines.has(line) &&
        !names.has("outputSchema") &&
        !spreads &&
        !opted
      ) {
        findings.push({ file, line, problem: "missing-output-schema" });
      }
      for (const property of options.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          propertyName(property) === "outputErrorStrategy" &&
          ts.isStringLiteralLike(property.initializer) &&
          property.initializer.text === "fallback" &&
          addedLines.has(lineOf(property))
        ) {
          findings.push({
            file,
            line: lineOf(property),
            problem: "fallback-strategy",
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
        finding.problem === "missing-output-schema"
          ? "new defineAction() has no outputSchema"
          : 'outputErrorStrategy: "fallback" is deprecated'
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
