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

function isExecuteCall(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  aliases: ReadonlySet<ts.Symbol>,
): boolean {
  if (ts.isIdentifier(expression)) {
    const symbol = checker.getSymbolAtLocation(expression);
    return symbol !== undefined && aliases.has(symbol);
  }
  return (
    isExecuteMethodWrapper(expression, "call", checker, sourceFile) ||
    isExecuteReference(expression, checker, sourceFile)
  );
}

function executeArgument(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  return isExecuteMethodWrapper(call.expression, "call", checker, sourceFile)
    ? call.arguments[1]
    : call.arguments[0];
}

function staticStringPropertyName(
  expression: ts.Expression | undefined,
): string | undefined {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current &&
    (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current))
    ? current.text
    : undefined;
}

function sqlPropertyReceiver(
  expression: ts.Expression,
): ts.Identifier | undefined {
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "sql" &&
    ts.isIdentifier(expression.expression)
  ) {
    return expression.expression;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    staticStringPropertyName(expression.argumentExpression) === "sql"
  ) {
    return expression.expression;
  }
  return undefined;
}

function isSqlPropertyAccess(expression: ts.Expression): boolean {
  return (
    (ts.isPropertyAccessExpression(expression) &&
      expression.name.text === "sql") ||
    (ts.isElementAccessExpression(expression) &&
      staticStringPropertyName(expression.argumentExpression) === "sql")
  );
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
  compound: boolean;
  uncertain: boolean;
  iteration: "in" | "of" | undefined;
}

interface ReachingAssignments {
  assignments: TaintedAssignment[];
  hasDominatingAssignment: boolean;
}

interface SqlAnalysis {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  assignments: Map<ts.Symbol, TaintedAssignment[]>;
  functions: Map<ts.Symbol, ts.FunctionLikeDeclaration[]>;
  executeAliases: ReadonlySet<ts.Symbol>;
  activeAssignments: Set<ts.Node>;
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

function isCoreDbExecModule(moduleName: string, file: string): boolean {
  if (moduleName === "@agent-native/core/db") return true;
  if (!moduleName.startsWith(".")) return false;
  const resolved = path
    .resolve(path.dirname(file), moduleName)
    .replace(/\.(?:[cm]?[jt]s|tsx?)$/i, "");
  return (
    resolved === path.resolve(rootDir, "packages/core/src/db/index") ||
    resolved === path.resolve(rootDir, "packages/core/src/db/client")
  );
}

function isCoreStateMachineModule(moduleName: string, file: string): boolean {
  if (moduleName === "@agent-native/core/state-machine") return true;
  if (!moduleName.startsWith(".")) return false;
  const resolved = path
    .resolve(path.dirname(file), moduleName)
    .replace(/\.(?:[cm]?[jt]s|tsx?)$/i, "");
  return (
    resolved === path.resolve(rootDir, "packages/core/src/state-machine/index")
  );
}

function isCoreExecutionFenceModule(moduleName: string, file: string): boolean {
  if (moduleName === "@agent-native/core/agent/execution-fence") return true;
  if (!moduleName.startsWith(".")) return false;
  const resolved = path
    .resolve(path.dirname(file), moduleName)
    .replace(/\.(?:[cm]?[jt]s|tsx?)$/i, "");
  return (
    resolved ===
    path.resolve(rootDir, "packages/core/src/agent/execution-fence")
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

function isImportedSqlNamespace(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return (
    symbol?.declarations?.some((declaration) => {
      if (!ts.isNamespaceImport(declaration)) return false;
      const importClause = declaration.parent;
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

function isImportedDbExecNamespace(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return (
    symbol?.declarations?.some((declaration) => {
      if (!ts.isNamespaceImport(declaration)) return false;
      const importClause = declaration.parent;
      if (!ts.isImportClause(importClause)) return false;
      const importDeclaration = importClause.parent;
      return (
        ts.isImportDeclaration(importDeclaration) &&
        ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
        isCoreDbExecModule(
          importDeclaration.moduleSpecifier.text,
          sourceFile.fileName,
        )
      );
    }) ?? false
  );
}

function isImportedDbExecNamespaceFactory(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "getDbExec" &&
    ts.isIdentifier(expression.expression)
  ) {
    return isImportedDbExecNamespace(
      expression.expression,
      checker,
      sourceFile,
    );
  }
  return (
    ts.isElementAccessExpression(expression) &&
    staticStringPropertyName(expression.argumentExpression) === "getDbExec" &&
    ts.isIdentifier(expression.expression) &&
    isImportedDbExecNamespace(expression.expression, checker, sourceFile)
  );
}

function isImportedSqlNamespaceAccess(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "sql" &&
    ts.isIdentifier(expression.expression)
  ) {
    return isImportedSqlNamespace(expression.expression, checker, sourceFile);
  }
  if (
    ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    staticStringPropertyName(expression.argumentExpression) === "sql"
  ) {
    return isImportedSqlNamespace(expression.expression, checker, sourceFile);
  }
  return false;
}

function isImportedDbExecFactory(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (isImportedDbExecNamespaceFactory(expression, checker, sourceFile)) {
    return true;
  }
  if (!ts.isIdentifier(expression)) return false;
  const symbol = checker.getSymbolAtLocation(expression);
  return (
    symbol?.declarations?.some((declaration) => {
      if (!ts.isImportSpecifier(declaration)) return false;
      const importedName = declaration.propertyName ?? declaration.name;
      if (importedName.text !== "getDbExec") return false;
      const importClause = declaration.parent.parent;
      if (!ts.isImportClause(importClause)) return false;
      const importDeclaration = importClause.parent;
      return (
        ts.isImportDeclaration(importDeclaration) &&
        ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
        isCoreDbExecModule(
          importDeclaration.moduleSpecifier.text,
          sourceFile.fileName,
        )
      );
    }) ?? false
  );
}

function isImportedFencedExecutionWrite(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return (
    symbol?.declarations?.some((declaration) => {
      if (!ts.isImportSpecifier(declaration)) return false;
      const importedName = declaration.propertyName ?? declaration.name;
      if (importedName.text !== "withFencedExecutionWrite") return false;
      const importClause = declaration.parent.parent;
      if (!ts.isImportClause(importClause)) return false;
      const importDeclaration = importClause.parent;
      return (
        ts.isImportDeclaration(importDeclaration) &&
        ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
        isCoreExecutionFenceModule(
          importDeclaration.moduleSpecifier.text,
          sourceFile.fileName,
        )
      );
    }) ?? false
  );
}

function isImportedDbExecType(
  type: ts.TypeNode,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: ReadonlySet<ts.Symbol> = new Set(),
): boolean {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(type.typeName);
  if (!symbol || seen.has(symbol)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(symbol);
  return (
    symbol.declarations?.some((declaration) => {
      if (ts.isTypeAliasDeclaration(declaration)) {
        return isImportedDbExecType(
          declaration.type,
          checker,
          sourceFile,
          nextSeen,
        );
      }
      if (!ts.isImportSpecifier(declaration)) return false;
      const importedName = declaration.propertyName ?? declaration.name;
      if (importedName.text !== "DbExec") return false;
      const importClause = declaration.parent.parent;
      if (!ts.isImportClause(importClause)) return false;
      const importDeclaration = importClause.parent;
      return (
        ts.isImportDeclaration(importDeclaration) &&
        ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
        isCoreDbExecModule(
          importDeclaration.moduleSpecifier.text,
          sourceFile.fileName,
        )
      );
    }) ?? false
  );
}

function isDbExecExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: ReadonlySet<ts.Symbol> = new Set(),
): boolean {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  if (
    ts.isCallExpression(current) &&
    isImportedDbExecFactory(current.expression, checker, sourceFile)
  ) {
    return true;
  }
  if (!ts.isIdentifier(current)) return false;
  const symbol = checker.getSymbolAtLocation(current);
  if (!symbol || seen.has(symbol)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(symbol);
  return (
    symbol.declarations?.some((declaration) => {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isDbExecExpression(
          declaration.initializer,
          checker,
          sourceFile,
          nextSeen,
        )
      ) {
        return true;
      }
      return (
        (ts.isVariableDeclaration(declaration) ||
          ts.isParameter(declaration) ||
          ts.isPropertyDeclaration(declaration) ||
          ts.isPropertySignature(declaration)) &&
        ((declaration.type !== undefined &&
          isImportedDbExecType(declaration.type, checker, sourceFile)) ||
          (ts.isParameter(declaration) &&
            isDbExecContextParameter(declaration, checker, sourceFile)))
      );
    }) ?? false
  );
}

function isDbExecContextParameter(
  parameter: ts.ParameterDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const parameterParent = parameter.parent;
  const callback =
    ts.isArrowFunction(parameterParent) ||
    ts.isFunctionExpression(parameterParent)
      ? parameterParent
      : parameterParent.parent;
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
    return false;
  }
  const call = callback.parent;
  if (
    !ts.isCallExpression(call) ||
    !call.arguments.some((argument) => argument === callback) ||
    call.arguments[0] !== callback
  ) {
    return false;
  }
  if (
    ts.isIdentifier(call.expression) &&
    isImportedFencedExecutionWrite(call.expression, checker, sourceFile)
  ) {
    return true;
  }
  const callee = call.expression;
  if (
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "transaction") ||
    (ts.isElementAccessExpression(callee) &&
      staticStringPropertyName(callee.argumentExpression) === "transaction")
  ) {
    return isDbExecExpression(callee.expression, checker, sourceFile);
  }
  return false;
}

function isImportedSqlFragmentType(
  type: ts.TypeNode,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: ReadonlySet<ts.Symbol> = new Set(),
): boolean {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(type.typeName);
  if (!symbol || seen.has(symbol)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(symbol);
  return (
    symbol.declarations?.some((declaration) => {
      if (ts.isTypeAliasDeclaration(declaration)) {
        return isImportedSqlFragmentType(
          declaration.type,
          checker,
          sourceFile,
          nextSeen,
        );
      }
      if (!ts.isImportSpecifier(declaration)) return false;
      const importedName = declaration.propertyName ?? declaration.name;
      if (importedName.text !== "SqlFragment") return false;
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

function isSqlFragmentDeclaration(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    symbol.declarations?.some((declaration) => {
      if (
        !ts.isVariableDeclaration(declaration) &&
        !ts.isParameter(declaration) &&
        !ts.isPropertyDeclaration(declaration) &&
        !ts.isPropertySignature(declaration)
      ) {
        return false;
      }
      return (
        declaration.type !== undefined &&
        isImportedSqlFragmentType(declaration.type, checker, sourceFile)
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
    (ts.isIdentifier(tag) &&
      isImportedSqlIdentifier(tag, checker, sourceFile)) ||
    isImportedSqlNamespaceAccess(tag, checker, sourceFile)
  );
}

function isSafeSqlHelperCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const callee = call.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ["ident", "in", "join", "value"].includes(callee.name.text) &&
    ((ts.isIdentifier(callee.expression) &&
      isImportedSqlIdentifier(callee.expression, checker, sourceFile)) ||
      isImportedSqlNamespaceAccess(callee.expression, checker, sourceFile))
  );
}

function isExecuteMethodWrapper(
  expression: ts.Expression,
  method: "bind" | "call",
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === method
  ) {
    return isExecuteReference(expression.expression, checker, sourceFile);
  }
  return (
    ts.isElementAccessExpression(expression) &&
    staticStringPropertyName(expression.argumentExpression) === method &&
    isExecuteReference(expression.expression, checker, sourceFile)
  );
}

function isExecuteReference(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (
    ts.isCallExpression(expression) &&
    isExecuteMethodWrapper(expression.expression, "bind", checker, sourceFile)
  ) {
    return true;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return (
      expression.name.text === "execute" &&
      isDbExecExpression(expression.expression, checker, sourceFile)
    );
  }
  return (
    ts.isElementAccessExpression(expression) &&
    staticStringPropertyName(expression.argumentExpression) === "execute" &&
    isDbExecExpression(expression.expression, checker, sourceFile)
  );
}

function isImportedMachineFactory(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  return (
    symbol?.declarations?.some((declaration) => {
      if (!ts.isImportSpecifier(declaration)) return false;
      const importedName = declaration.propertyName ?? declaration.name;
      if (importedName.text !== "defineMachine") return false;
      const importClause = declaration.parent.parent;
      if (!ts.isImportClause(importClause)) return false;
      const importDeclaration = importClause.parent;
      return (
        ts.isImportDeclaration(importDeclaration) &&
        ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
        isCoreStateMachineModule(
          importDeclaration.moduleSpecifier.text,
          sourceFile.fileName,
        )
      );
    }) ?? false
  );
}

function isMachineSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: ReadonlySet<ts.Symbol> = new Set(),
): boolean {
  if (seen.has(symbol)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(symbol);
  return (
    symbol.declarations?.some((declaration) => {
      if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) {
        return false;
      }
      const declarationList = declaration.parent;
      if (
        !ts.isVariableDeclarationList(declarationList) ||
        (declarationList.flags & ts.NodeFlags.Const) === 0
      ) {
        return false;
      }
      const initializer = declaration.initializer;
      if (
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression)
      ) {
        return isImportedMachineFactory(
          initializer.expression,
          checker,
          sourceFile,
        );
      }
      if (ts.isIdentifier(initializer)) {
        const source = checker.getSymbolAtLocation(initializer);
        return (
          source !== undefined &&
          isMachineSymbol(source, checker, sourceFile, nextSeen)
        );
      }
      return false;
    }) ?? false
  );
}

function isSafeSqlMachineCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    callee.name.text !== "sqlIn" ||
    !ts.isIdentifier(callee.expression)
  ) {
    return false;
  }
  const symbol = checker.getSymbolAtLocation(callee.expression);
  return symbol !== undefined && isMachineSymbol(symbol, checker, sourceFile);
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

function assignmentTargets(node: ts.Node): ts.Identifier[] {
  if (ts.isIdentifier(node)) return [node];
  if (ts.isBindingElement(node)) return assignmentTargets(node.name);
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    return node.elements.flatMap(assignmentTargets);
  }
  if (ts.isPropertyAssignment(node)) return assignmentTargets(node.initializer);
  if (ts.isShorthandPropertyAssignment(node)) return [node.name];
  if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) {
    return assignmentTargets(node.expression);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap(assignmentTargets);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap(assignmentTargets);
  }
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return assignmentTargets(node.expression);
  }
  return [];
}

function buildSqlAnalysis(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): SqlAnalysis {
  const assignments = new Map<ts.Symbol, TaintedAssignment[]>();
  const functions = new Map<ts.Symbol, ts.FunctionLikeDeclaration[]>();
  const aliases = new Map<ts.Symbol, Set<ts.Symbol>>();
  const executeAliases = new Set<ts.Symbol>();
  const sqlPropertyWrites = new Map<ts.Symbol, TaintedAssignment[]>();
  const addAlias = (
    left: ts.Symbol | undefined,
    right: ts.Symbol | undefined,
  ) => {
    if (!left || !right || left === right) return;
    const leftAliases = aliases.get(left) ?? new Set<ts.Symbol>();
    leftAliases.add(right);
    aliases.set(left, leftAliases);
    const rightAliases = aliases.get(right) ?? new Set<ts.Symbol>();
    rightAliases.add(left);
    aliases.set(right, rightAliases);
  };
  const addAssignment = (
    identifier: ts.Identifier,
    node: ts.Node,
    expression: ts.Expression,
    compound = false,
    uncertain = false,
    iteration: "in" | "of" | undefined = undefined,
  ) => {
    const symbol = ts.isShorthandPropertyAssignment(identifier.parent)
      ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
      : checker.getSymbolAtLocation(identifier);
    if (symbol) {
      appendToMapList(assignments, symbol, {
        node,
        expression,
        compound,
        uncertain,
        iteration,
      });
    }
  };
  const addFunction = (
    symbol: ts.Symbol | undefined,
    declaration: ts.FunctionLikeDeclaration | undefined,
  ) => {
    if (symbol && declaration) appendToMapList(functions, symbol, declaration);
  };
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      for (const target of assignmentTargets(node.name)) {
        addAssignment(
          target,
          node,
          node.initializer,
          false,
          !ts.isIdentifier(node.name),
        );
      }
      if (ts.isIdentifier(node.name)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        addFunction(symbol, functionExpression(node.initializer));
        if (
          symbol &&
          isExecuteReference(node.initializer, checker, sourceFile)
        ) {
          executeAliases.add(symbol);
        }
        if (ts.isIdentifier(node.initializer)) {
          const source = checker.getSymbolAtLocation(node.initializer);
          addAlias(symbol, source);
          if (symbol && source && executeAliases.has(source)) {
            executeAliases.add(symbol);
          }
        }
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        isDbExecExpression(node.initializer, checker, sourceFile)
      ) {
        for (const element of node.name.elements) {
          const propertyName = element.propertyName ?? element.name;
          if (
            element.dotDotToken ||
            !(
              ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)
            ) ||
            propertyName.text !== "execute" ||
            !ts.isIdentifier(element.name)
          ) {
            continue;
          }
          const symbol = checker.getSymbolAtLocation(element.name);
          if (symbol) executeAliases.add(symbol);
        }
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      const compound = node.operatorToken.kind !== ts.SyntaxKind.EqualsToken;
      if (ts.isIdentifier(node.left)) {
        addAssignment(node.left, node, node.right, compound);
        addFunction(
          checker.getSymbolAtLocation(node.left),
          functionExpression(node.right),
        );
        const symbol = checker.getSymbolAtLocation(node.left);
        if (
          !compound &&
          symbol &&
          isExecuteReference(node.right, checker, sourceFile)
        ) {
          executeAliases.add(symbol);
        }
        if (!compound && ts.isIdentifier(node.right)) {
          const source = checker.getSymbolAtLocation(node.right);
          addAlias(symbol, source);
          if (symbol && source && executeAliases.has(source)) {
            executeAliases.add(symbol);
          }
        }
      } else {
        const receiver = sqlPropertyReceiver(node.left);
        const symbol = receiver && checker.getSymbolAtLocation(receiver);
        if (symbol) {
          appendToMapList(sqlPropertyWrites, symbol, {
            node,
            expression: node.right,
            compound,
            uncertain: false,
            iteration: undefined,
          });
        } else if (!compound) {
          for (const target of assignmentTargets(node.left)) {
            addAssignment(target, node, node.right, false, true);
          }
        }
      }
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const targets = ts.isVariableDeclarationList(node.initializer)
        ? node.initializer.declarations.flatMap((declaration) =>
            assignmentTargets(declaration.name),
          )
        : assignmentTargets(node.initializer);
      for (const target of targets) {
        addAssignment(
          target,
          node,
          node.expression,
          false,
          true,
          ts.isForInStatement(node) ? "in" : "of",
        );
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
  const pendingExecuteAliases = [...executeAliases];
  while (pendingExecuteAliases.length > 0) {
    const current = pendingExecuteAliases.pop();
    if (!current) continue;
    for (const alias of aliases.get(current) ?? []) {
      if (executeAliases.has(alias)) continue;
      executeAliases.add(alias);
      pendingExecuteAliases.push(alias);
    }
  }
  for (const [receiver, writes] of sqlPropertyWrites) {
    const relatedSymbols = new Set<ts.Symbol>([receiver]);
    const pending = [receiver];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      for (const alias of aliases.get(current) ?? []) {
        if (relatedSymbols.has(alias)) continue;
        relatedSymbols.add(alias);
        pending.push(alias);
      }
    }
    for (const symbol of relatedSymbols) {
      for (const write of writes) {
        appendToMapList(assignments, symbol, write);
      }
    }
  }
  return {
    sourceFile,
    checker,
    assignments,
    functions,
    executeAliases,
    activeAssignments: new Set(),
  };
}

function statementBlock(node: ts.Node): ts.Block | ts.SourceFile | undefined {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isFunctionLike(parent) || ts.isClassLike(parent)) {
      return undefined;
    }
    if (ts.isStatement(parent)) {
      return ts.isBlock(parent.parent) || ts.isSourceFile(parent.parent)
        ? parent.parent
        : undefined;
    }
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) return parent;
    current = parent;
  }
  return undefined;
}

function assignmentBlock(
  assignment: TaintedAssignment,
): ts.Block | ts.SourceFile | undefined {
  let current = assignment.node;
  if (ts.isBinaryExpression(current)) {
    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent) ||
        ts.isSatisfiesExpression(current.parent))
    ) {
      current = current.parent;
    }
    if (!ts.isExpressionStatement(current.parent)) return undefined;
    current = current.parent;
  } else if (ts.isVariableDeclaration(current)) {
    while (current.parent && !ts.isVariableStatement(current.parent)) {
      if (ts.isStatement(current.parent) || ts.isFunctionLike(current.parent)) {
        return undefined;
      }
      current = current.parent;
    }
    if (!ts.isVariableStatement(current.parent)) return undefined;
    current = current.parent;
  } else {
    return undefined;
  }
  return ts.isBlock(current.parent) || ts.isSourceFile(current.parent)
    ? current.parent
    : undefined;
}

function enclosingFunction(
  node: ts.Node,
): ts.FunctionLikeDeclaration | undefined {
  let current = node;
  while (current.parent) {
    current = current.parent;
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

function isLoopBody(block: ts.Block | ts.SourceFile): boolean {
  let current: ts.Node = block;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isFunctionLike(parent) || ts.isClassLike(parent)) return false;
    if (
      ts.isIterationStatement(parent, false) &&
      parent.statement === current
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

function reachingAssignments(
  symbol: ts.Symbol,
  reference: ts.Identifier,
  analysis: SqlAnalysis,
): ReachingAssignments {
  const position = reference.getStart(analysis.sourceFile);
  const block = statementBlock(reference);
  const repeatedBlock = block !== undefined && isLoopBody(block);
  const candidates = (analysis.assignments.get(symbol) ?? []).filter(
    (assignment) => {
      const assignedBlock = assignmentBlock(assignment);
      return (
        !analysis.activeAssignments.has(assignment.node) &&
        (!block ||
          assignedBlock !== block ||
          assignment.node.end <= position ||
          repeatedBlock)
      );
    },
  );
  if (!block) {
    return { assignments: candidates, hasDominatingAssignment: false };
  }
  let latestDominating: TaintedAssignment | undefined;
  for (const assignment of candidates) {
    if (
      assignmentBlock(assignment) !== block ||
      assignment.node.end > position
    ) {
      continue;
    }
    if (
      !latestDominating ||
      assignment.node.getStart(analysis.sourceFile) >
        latestDominating.node.getStart(analysis.sourceFile)
    ) {
      latestDominating = assignment;
    }
  }
  const referenceFunction = enclosingFunction(reference);
  return {
    assignments: candidates.filter((assignment) => {
      const assignedBlock = assignmentBlock(assignment);
      const overwrittenInScope =
        latestDominating !== undefined &&
        assignment.node.getStart(analysis.sourceFile) <
          latestDominating.node.getStart(analysis.sourceFile) &&
        enclosingFunction(assignment.node) === referenceFunction;
      const followsReferenceInScope =
        !repeatedBlock &&
        assignment.node.getStart(analysis.sourceFile) > position &&
        enclosingFunction(assignment.node) === referenceFunction;
      return (
        !overwrittenInScope &&
        !followsReferenceInScope &&
        (assignedBlock !== block ||
          assignment.node.end > position ||
          assignment === latestDominating)
      );
    }),
    hasDominatingAssignment: latestDominating !== undefined,
  };
}

function isStringLikeType(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  return mayBeStringType(checker.getTypeAtLocation(expression));
}

function mayBeStringType(type: ts.Type, seen = new Set<ts.Type>()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  if (
    (type.flags &
      (ts.TypeFlags.StringLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !==
    0
  ) {
    return true;
  }
  return (
    type.isUnionOrIntersection() &&
    type.types.some((member) => mayBeStringType(member, seen))
  );
}

function isPotentialStringType(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): boolean {
  return mayBeStringType(checker.getTypeAtLocation(expression));
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
    (expression.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      expression.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
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

function isStaticSqlValue(expression: ts.Expression): boolean {
  if (isStaticStringExpression(expression)) return true;
  if (
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return true;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        isStaticSqlValue(property.initializer),
    );
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.every(
      (element) =>
        !ts.isSpreadElement(element) &&
        (ts.isOmittedExpression(element) || isStaticSqlValue(element)),
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
    if (
      isSqlFragmentDeclaration(symbol, analysis.checker, analysis.sourceFile) &&
      (analysis.assignments.get(symbol) ?? []).length === 0
    ) {
      return new Set();
    }

    const reaching = reachingAssignments(symbol, current, analysis);
    if (reaching.assignments.length > 0) {
      const nextSymbols = new Set(seenSymbols);
      nextSymbols.add(symbol);
      const assignmentSources = reaching.assignments.map((assignment) => {
        if (analysis.activeAssignments.has(assignment.node)) {
          return new Set<ts.Node>();
        }
        analysis.activeAssignments.add(assignment.node);
        let sources = new Set<ts.Node>();
        try {
          if (assignment.iteration === "in") {
            sources.add(assignment.node);
          } else if (assignment.iteration === "of") {
            const iterableType = analysis.checker.getTypeAtLocation(
              assignment.expression,
            );
            const elementType = analysis.checker.getIndexTypeOfType(
              iterableType,
              ts.IndexKind.Number,
            );
            if (
              isPotentialStringType(current, analysis.checker) &&
              (!elementType || mayBeStringType(elementType)) &&
              !isStaticSqlValue(assignment.expression)
            ) {
              sources.add(assignment.node);
            }
          } else {
            const sourceExpression =
              assignment.compound && ts.isBinaryExpression(assignment.node)
                ? assignment.node
                : assignment.expression;
            sources = findUnsafeSqlSources(
              sourceExpression,
              analysis,
              assignment.compound ? seenSymbols : nextSymbols,
              seenFunctions,
            );
            if (
              assignment.uncertain &&
              sources.size === 0 &&
              !isStaticSqlValue(assignment.expression) &&
              isPotentialStringType(current, analysis.checker)
            ) {
              sources.add(assignment.node);
            }
            if (sources.size > 0) sources.add(assignment.node);
          }
        } finally {
          analysis.activeAssignments.delete(assignment.node);
        }
        return sources;
      });
      const sources = unionSources(...assignmentSources);
      const declaration = symbol.valueDeclaration;
      if (
        declaration &&
        ts.isParameter(declaration) &&
        !reaching.hasDominatingAssignment &&
        isPotentialStringType(current, analysis.checker)
      ) {
        sources.add(declaration);
      }
      return sources;
    }
    return isPotentialStringType(current, analysis.checker)
      ? new Set([symbol.valueDeclaration ?? current])
      : new Set();
  }
  if (ts.isCallExpression(current)) {
    if (
      isSafeSqlHelperCall(current, analysis.checker, analysis.sourceFile) ||
      isSafeSqlMachineCall(current, analysis.checker, analysis.sourceFile)
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
      (current.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        current.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
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
      if (sources.size > 0) return sources;
      if (current.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) {
        return new Set();
      }
      return isStaticStringExpression(current) ? new Set() : new Set([current]);
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
  if (ts.isObjectLiteralExpression(current)) {
    if (isStaticSqlValue(current)) return new Set();
    return unionSources(
      ...current.properties.flatMap((property) => {
        if (ts.isPropertyAssignment(property)) {
          return [
            findUnsafeSqlSources(
              property.initializer,
              analysis,
              seenSymbols,
              seenFunctions,
            ),
          ];
        }
        if (ts.isShorthandPropertyAssignment(property)) {
          return [
            findUnsafeSqlSources(
              property.name,
              analysis,
              seenSymbols,
              seenFunctions,
            ),
          ];
        }
        if (ts.isSpreadAssignment(property)) {
          return [
            findUnsafeSqlSources(
              property.expression,
              analysis,
              seenSymbols,
              seenFunctions,
            ),
          ];
        }
        return [];
      }),
    );
  }
  if (ts.isArrayLiteralExpression(current)) {
    if (isStaticSqlValue(current)) return new Set();
    return unionSources(
      ...current.elements.map((element) =>
        ts.isSpreadElement(element)
          ? findUnsafeSqlSources(
              element.expression,
              analysis,
              seenSymbols,
              seenFunctions,
            )
          : findUnsafeSqlSources(element, analysis, seenSymbols, seenFunctions),
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
  const previousLine = lines[startLine - 2] ?? "";
  const trimmedPreviousLine = previousLine.trim();
  const previousLineIsComment =
    trimmedPreviousLine.startsWith("//") ||
    trimmedPreviousLine.startsWith("--") ||
    (trimmedPreviousLine.startsWith("/*") &&
      trimmedPreviousLine.endsWith("*/")) ||
    (trimmedPreviousLine.startsWith("*") &&
      (!trimmedPreviousLine.includes("*/") ||
        trimmedPreviousLine.endsWith("*/")));
  return (
    (previousLineIsComment && pragma.test(previousLine)) ||
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
    if (
      ts.isCallExpression(node) &&
      isExecuteCall(
        node.expression,
        checker,
        sourceFile,
        analysis.executeAliases,
      )
    ) {
      const argument = executeArgument(node, checker, sourceFile);
      if (argument) reportUnsafeSqlValue(node, argument);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isSqlPropertyAccess(node.left)
    ) {
      reportUnsafeSqlValue(node, node.right);
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
