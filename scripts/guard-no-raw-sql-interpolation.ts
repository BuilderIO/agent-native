import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourceExtension = /\.[cm]?[jt]sx?$/;
const generatedPath =
  /(^|\/)(?:node_modules|dist|build|coverage|\.generated)(\/|$)/;
const pragma = /(?:\/\/|\/\*|\*|--)\s*raw-sql-ok:\s*\S/;

export interface RawSqlInterpolationFinding {
  file: string;
  line: number;
  snippet: string;
}

function scriptKind(file: string): ts.ScriptKind {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.(?:mjs|cjs|js)$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isSqlPropertyName(name: ts.PropertyName): boolean {
  return (
    (ts.isIdentifier(name) && name.text === "sql") ||
    (ts.isStringLiteral(name) && name.text === "sql")
  );
}

function interpolatedTemplate(
  expression: ts.Expression,
): ts.TemplateExpression | undefined {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isTemplateExpression(current) ? current : undefined;
}

function isExecuteCall(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === "execute";
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === "execute";
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    return (
      argument !== undefined &&
      ts.isStringLiteral(argument) &&
      argument.text === "execute"
    );
  }
  return false;
}

function lineNumberAt(sourceFile: ts.SourceFile, position: number): number {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function hasPragma(
  lines: string[],
  startLine: number,
  endLine: number,
): boolean {
  return (
    pragma.test(lines[startLine - 2] ?? "") ||
    lines.slice(startLine - 1, endLine).some((line) => pragma.test(line))
  );
}

export function findRawSqlInterpolationViolations(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): RawSqlInterpolationFinding[] {
  const normalizedFile = file.replaceAll("\\", "/");
  if (
    !sourceExtension.test(normalizedFile) ||
    generatedPath.test(normalizedFile)
  ) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & {
      parseDiagnostics: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    const diagnostic = parseDiagnostics[0];
    const message = diagnostic
      ? ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      : "unknown parse error";
    throw new Error(`${file}: could not parse source: ${message}`);
  }

  const lines = source.split(/\r?\n/);
  const findings: RawSqlInterpolationFinding[] = [];

  const reportIfAdded = (node: ts.Node) => {
    const startLine = lineNumberAt(sourceFile, node.getStart(sourceFile));
    const endLine = lineNumberAt(sourceFile, node.end);
    const touched = [...addedLines].some(
      (line) => line >= startLine && line <= endLine,
    );
    if (!touched || hasPragma(lines, startLine, endLine)) return;

    findings.push({
      file,
      line: startLine,
      snippet: (lines[startLine - 1] ?? "").trim().slice(0, 160),
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && isSqlPropertyName(node.name)) {
      const template = interpolatedTemplate(node.initializer);
      if (template && template.templateSpans.length > 0) {
        reportIfAdded(node);
      }
    }
    if (ts.isCallExpression(node) && isExecuteCall(node.expression)) {
      const argument = node.arguments[0];
      const template = argument ? interpolatedTemplate(argument) : undefined;
      if (template && template.templateSpans.length > 0) {
        reportIfAdded(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return findings;
}

function main() {
  const added = requireAddedLines(rootDir, "guard:no-raw-sql-interpolation");
  const findings: RawSqlInterpolationFinding[] = [];

  for (const [absolutePath, addedLines] of added) {
    const relativePath = path
      .relative(rootDir, absolutePath)
      .replace(/\\/g, "/");
    if (
      !sourceExtension.test(relativePath) ||
      generatedPath.test(relativePath)
    ) {
      continue;
    }

    let source: string;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `guard:no-raw-sql-interpolation: could not read ${relativePath}: ${message}`,
      );
      process.exit(2);
    }

    try {
      findings.push(
        ...findRawSqlInterpolationViolations(relativePath, source, addedLines),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`guard:no-raw-sql-interpolation: ${message}`);
      process.exit(2);
    }
  }

  if (findings.length === 0) {
    console.log("guard:no-raw-sql-interpolation: no new raw SQL interpolation");
    return;
  }

  console.error(
    `guard:no-raw-sql-interpolation: ${findings.length} interpolated SQL template(s) added.`,
  );
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.snippet}`);
  }
  console.error(
    "Compose SQL with sql fragments and bound values. Reviewed exceptions need a reason: // raw-sql-ok: <reason>",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
