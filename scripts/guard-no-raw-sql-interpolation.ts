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
  if (ts.isComputedPropertyName(name)) {
    return (
      ts.isStringLiteral(name.expression) && name.expression.text === "sql"
    );
  }
  return (
    (ts.isIdentifier(name) && name.text === "sql") ||
    (ts.isStringLiteral(name) && name.text === "sql")
  );
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

function createChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
  const absoluteFile = path.resolve(sourceFile.fileName);
  const options: ts.CompilerOptions = {
    allowJs: true,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  };
  const baseHost = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (fileName) => path.resolve(fileName) === absoluteFile,
    getSourceFile: (fileName) =>
      path.resolve(fileName) === absoluteFile ? sourceFile : undefined,
    readFile: (fileName) =>
      path.resolve(fileName) === absoluteFile ? sourceFile.text : undefined,
  };
  return ts.createProgram([absoluteFile], options, host).getTypeChecker();
}

interface TaintedAssignment {
  node: ts.Node;
  expression: ts.Expression;
}

interface SqlAnalysis {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  assignments: Map<ts.Symbol, TaintedAssignment[]>;
  functions: Map<ts.Symbol, ts.FunctionLikeDeclaration[]>;
}

function isCoreDbModule(moduleName: string, file: string): boolean {
  if (
    moduleName === "@agent-native/core/db" ||
    moduleName === "@agent-native/core/db/sql"
  ) {
    return true;
  }
  if (!moduleName.startsWith(".")) return false;
  const resolved = path
    .resolve(path.dirname(file), moduleName)
    .replace(/\.(?:[cm]?[jt]s|tsx?)$/i, "");
  return (
    resolved === path.resolve(rootDir, "packages/core/src/db/sql") ||
    resolved === path.resolve(rootDir, "packages/core/src/db/index")
  );
}

function isImportedSqlIdentifier(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return (
    symbol?.declarations?.some((declaration) => {
      if (!ts.isImportSpecifier(declaration)) return false;
      const importedName = declaration.propertyName ?? declaration.name;
      if (importedName.text !== "sql") return false;
      const importClause = declaration.parent.parent;
      if (!ts.isImportClause(importClause)) return false;
      const importDeclaration = importClause.parent;
      return (
        ts.isImportDeclaration(importDeclaration) &&
        ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
        isCoreDbModule(
          importDeclaration.moduleSpecifier.text,
          sourceFile.fileName,
        )
      );
    }) ?? false
  );
}

function isSafeSqlTag(
  tag: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    ts.isIdentifier(tag) && isImportedSqlIdentifier(tag, checker, sourceFile)
  );
}

function isSafeSqlFragmentCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const callee = call.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    (callee.name.text === "in" || callee.name.text === "join") &&
    ts.isIdentifier(callee.expression) &&
    isImportedSqlIdentifier(callee.expression, checker, sourceFile)
  );
}

function appendToMapList<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function functionExpression(
  expression: ts.Expression,
): ts.FunctionLikeDeclaration | undefined {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)
    ? expression
    : undefined;
}

function buildSqlAnalysis(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): SqlAnalysis {
  const assignments = new Map<ts.Symbol, TaintedAssignment[]>();
  const functions = new Map<ts.Symbol, ts.FunctionLikeDeclaration[]>();
  const addFunction = (
    symbol: ts.Symbol | undefined,
    declaration: ts.FunctionLikeDeclaration | undefined,
  ) => {
    if (symbol && declaration) appendToMapList(functions, symbol, declaration);
  };
  const collect = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        appendToMapList(assignments, symbol, {
          node,
          expression: node.initializer,
        });
        addFunction(symbol, functionExpression(node.initializer));
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const symbol = checker.getSymbolAtLocation(node.left);
      if (symbol) {
        appendToMapList(assignments, symbol, {
          node,
          expression: node.right,
        });
        addFunction(symbol, functionExpression(node.right));
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      addFunction(checker.getSymbolAtLocation(node.name), node);
    }
    if (ts.isMethodDeclaration(node)) {
      addFunction(checker.getSymbolAtLocation(node.name), node);
    }
    if (ts.isPropertyAssignment(node) && functionExpression(node.initializer)) {
      addFunction(
        checker.getSymbolAtLocation(node.name),
        functionExpression(node.initializer),
      );
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  return { sourceFile, checker, assignments, functions };
}

function latestAssignment(
  symbol: ts.Symbol,
  position: number,
  analysis: SqlAnalysis,
): TaintedAssignment | undefined {
  let latest: TaintedAssignment | undefined;
  for (const assignment of analysis.assignments.get(symbol) ?? []) {
    if (assignment.node.getStart(analysis.sourceFile) >= position) continue;
    if (
      !latest ||
      assignment.node.getStart(analysis.sourceFile) >
        latest.node.getStart(analysis.sourceFile)
    ) {
      latest = assignment;
    }
  }
  return latest;
}

function isStringLikeType(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  return (
    (checker.getTypeAtLocation(expression).flags & ts.TypeFlags.StringLike) !==
    0
  );
}

function isPotentialStringType(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  return (
    (checker.getTypeAtLocation(expression).flags &
      (ts.TypeFlags.StringLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !==
    0
  );
}

function isStaticStringExpression(expression: ts.Expression): boolean {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return true;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return isStaticStringExpression(expression.expression);
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return (
      isStaticStringExpression(expression.left) &&
      isStaticStringExpression(expression.right)
    );
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      isStaticStringExpression(expression.whenTrue) &&
      isStaticStringExpression(expression.whenFalse)
    );
  }
  return false;
}

function returnExpressions(
  declaration: ts.FunctionLikeDeclaration,
): ts.Expression[] {
  const body = declaration.body;
  if (!body) return [];
  if (ts.isArrowFunction(declaration) && !ts.isBlock(body)) return [body];
  if (!ts.isBlock(body)) return [];

  const expressions: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      expressions.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return expressions;
}

function unionSources(...sets: ReadonlySet<ts.Node>[]): Set<ts.Node> {
  const sources = new Set<ts.Node>();
  for (const set of sets) {
    for (const source of set) sources.add(source);
  }
  return sources;
}

function findUnsafeSqlSources(
  expression: ts.Expression,
  analysis: SqlAnalysis,
  seenSymbols: ReadonlySet<ts.Symbol> = new Set(),
  seenFunctions: ReadonlySet<ts.Symbol> = new Set(),
): Set<ts.Node> {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }

  if (ts.isTaggedTemplateExpression(current)) {
    if (isSafeSqlTag(current.tag, analysis.checker, analysis.sourceFile)) {
      return new Set();
    }
    return ts.isTemplateExpression(current.template) &&
      current.template.templateSpans.length > 0
      ? new Set([current])
      : new Set();
  }
  if (ts.isTemplateExpression(current)) {
    return current.templateSpans.length > 0 ? new Set([current]) : new Set();
  }
  if (ts.isIdentifier(current)) {
    const symbol = analysis.checker.getSymbolAtLocation(current);
    if (!symbol || seenSymbols.has(symbol)) return new Set();

    const assignment = latestAssignment(
      symbol,
      current.getStart(analysis.sourceFile),
      analysis,
    );
    if (assignment) {
      const nextSymbols = new Set(seenSymbols);
      nextSymbols.add(symbol);
      return findUnsafeSqlSources(
        assignment.expression,
        analysis,
        nextSymbols,
        seenFunctions,
      );
    }
    return isPotentialStringType(current, analysis.checker)
      ? new Set([symbol.valueDeclaration ?? current])
      : new Set();
  }
  if (ts.isCallExpression(current)) {
    if (
      isSafeSqlFragmentCall(current, analysis.checker, analysis.sourceFile) ||
      (ts.isPropertyAccessExpression(current.expression) &&
        current.expression.name.text === "sqlIn")
    ) {
      return new Set();
    }
    const symbol = analysis.checker.getSymbolAtLocation(current.expression);
    const declarations = symbol ? analysis.functions.get(symbol) : undefined;
    if (symbol && declarations && declarations.length > 0) {
      if (seenFunctions.has(symbol)) return new Set();
      const nextFunctions = new Set(seenFunctions);
      nextFunctions.add(symbol);
      return unionSources(
        ...declarations.flatMap((declaration) =>
          returnExpressions(declaration).map((returned) =>
            findUnsafeSqlSources(
              returned,
              analysis,
              seenSymbols,
              nextFunctions,
            ),
          ),
        ),
      );
    }
    return isPotentialStringType(current, analysis.checker)
      ? new Set([current])
      : new Set();
  }
  if (ts.isBinaryExpression(current)) {
    if (
      current.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (isStringLikeType(current, analysis.checker) ||
        ts.isStringLiteralLike(current.left) ||
        ts.isStringLiteralLike(current.right))
    ) {
      const sources = unionSources(
        findUnsafeSqlSources(
          current.left,
          analysis,
          seenSymbols,
          seenFunctions,
        ),
        findUnsafeSqlSources(
          current.right,
          analysis,
          seenSymbols,
          seenFunctions,
        ),
      );
      return sources.size > 0
        ? sources
        : isStaticStringExpression(current)
          ? new Set()
          : new Set([current]);
    }
    return unionSources(
      findUnsafeSqlSources(current.left, analysis, seenSymbols, seenFunctions),
      findUnsafeSqlSources(current.right, analysis, seenSymbols, seenFunctions),
    );
  }
  if (ts.isConditionalExpression(current)) {
    return unionSources(
      findUnsafeSqlSources(
        current.whenTrue,
        analysis,
        seenSymbols,
        seenFunctions,
      ),
      findUnsafeSqlSources(
        current.whenFalse,
        analysis,
        seenSymbols,
        seenFunctions,
      ),
    );
  }
  if (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    return isPotentialStringType(current, analysis.checker)
      ? new Set([current])
      : new Set();
  }
  return isPotentialStringType(current, analysis.checker) &&
    !isStaticStringExpression(current)
    ? new Set([current])
    : new Set();
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
    path.resolve(file),
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
  const reportedLines = new Set<string>();
  const checker = createChecker(sourceFile);
  const analysis = buildSqlAnalysis(sourceFile, checker);

  const touchesAddedLines = (node: ts.Node) => {
    const startLine = lineNumberAt(sourceFile, node.getStart(sourceFile));
    const endLine = lineNumberAt(sourceFile, node.end);
    return [...addedLines].some((line) => line >= startLine && line <= endLine);
  };

  const reportIfAdded = (node: ts.Node) => {
    const startLine = lineNumberAt(sourceFile, node.getStart(sourceFile));
    const endLine = lineNumberAt(sourceFile, node.end);
    const touched = touchesAddedLines(node);
    if (!touched || hasPragma(lines, startLine, endLine)) return;
    const key = `${file}:${startLine}`;
    if (reportedLines.has(key)) return;
    reportedLines.add(key);

    findings.push({
      file,
      line: startLine,
      snippet: (lines[startLine - 1] ?? "").trim().slice(0, 160),
    });
  };

  const hasNodePragma = (node: ts.Node) =>
    hasPragma(
      lines,
      lineNumberAt(sourceFile, node.getStart(sourceFile)),
      lineNumberAt(sourceFile, node.end),
    );

  const reportUnsafeSqlValue = (sink: ts.Node, value: ts.Expression) => {
    if (hasNodePragma(sink)) return;
    const sources = findUnsafeSqlSources(value, analysis);
    if (sources.size === 0) return;

    const changedSources = [...sources].filter(touchesAddedLines);
    if (changedSources.length === 0) {
      reportIfAdded(sink);
      return;
    }
    for (const source of changedSources) reportIfAdded(source);
  };

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && isSqlPropertyName(node.name)) {
      reportUnsafeSqlValue(node, node.initializer);
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === "sql") {
      reportUnsafeSqlValue(node, node.name);
    }
    if (ts.isCallExpression(node) && isExecuteCall(node.expression)) {
      const argument = node.arguments[0];
      if (argument) reportUnsafeSqlValue(node, argument);
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
