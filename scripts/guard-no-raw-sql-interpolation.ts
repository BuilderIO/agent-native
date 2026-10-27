import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

function createProgram(sourceFiles: readonly ts.SourceFile[]): ts.Program {
  const options: ts.CompilerOptions = {
    allowJs: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    target: ts.ScriptTarget.Latest,
  };
  const baseHost = ts.createCompilerHost(options);
  const filesByPath = new Map(
    sourceFiles.map((sourceFile) => [
      path.resolve(sourceFile.fileName),
      sourceFile,
    ]),
  );
  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (fileName) => filesByPath.has(path.resolve(fileName)),
    getSourceFile: (fileName) => filesByPath.get(path.resolve(fileName)),
    readFile: (fileName) => filesByPath.get(path.resolve(fileName))?.text,
  };
  return ts.createProgram([...filesByPath.keys()], options, host);
}

function createChecker(sourceFile: ts.SourceFile): ts.TypeChecker {
  return createProgram([sourceFile]).getTypeChecker();
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
  relatedAnalyses?: ReadonlyMap<ts.SourceFile, SqlAnalysis>;
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
  seen: ReadonlySet<ts.Symbol> = new Set(),
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol || seen.has(symbol)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(symbol);
  return (
    symbol.declarations?.some((declaration) => {
      if (ts.isNamespaceImport(declaration)) {
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
      }
      return (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined &&
        (isDynamicDbExecImport(declaration.initializer, sourceFile) ||
          isImportedDbExecNamespaceExpression(
            declaration.initializer,
            checker,
            sourceFile,
            nextSeen,
          ))
      );
    }) ?? false
  );
}

function isDynamicDbExecImport(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): boolean {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return (
    ts.isCallExpression(current) &&
    current.expression.kind === ts.SyntaxKind.ImportKeyword &&
    ts.isStringLiteral(current.arguments[0]) &&
    isCoreDbExecModule(current.arguments[0].text, sourceFile.fileName)
  );
}

function isImportedDbExecNamespaceExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: ReadonlySet<ts.Symbol> = new Set(),
): boolean {
  if (ts.isIdentifier(expression)) {
    return isImportedDbExecNamespace(expression, checker, sourceFile, seen);
  }
  return isDynamicDbExecImport(expression, sourceFile);
}

function isImportedDbExecNamespaceFactory(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "getDbExec"
  ) {
    return isImportedDbExecNamespaceExpression(
      expression.expression,
      checker,
      sourceFile,
    );
  }
  return (
    ts.isElementAccessExpression(expression) &&
    staticStringPropertyName(expression.argumentExpression) === "getDbExec" &&
    isImportedDbExecNamespaceExpression(
      expression.expression,
      checker,
      sourceFile,
    )
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
      if (ts.isImportSpecifier(declaration)) {
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
      }
      if (ts.isBindingElement(declaration)) {
        const importedName = declaration.propertyName ?? declaration.name;
        const variable = declaration.parent.parent;
        return (
          (ts.isIdentifier(importedName) || ts.isStringLiteral(importedName)) &&
          importedName.text === "getDbExec" &&
          ts.isVariableDeclaration(variable) &&
          variable.initializer !== undefined &&
          isDynamicDbExecImport(variable.initializer, sourceFile)
        );
      }
      return (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined &&
        isImportedDbExecNamespaceFactory(
          declaration.initializer,
          checker,
          sourceFile,
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
  let symbol: ts.Symbol | undefined;
  if (ts.isIdentifier(current)) {
    symbol = checker.getSymbolAtLocation(current);
  } else if (ts.isPropertyAccessExpression(current)) {
    symbol = checker.getSymbolAtLocation(current.name);
  } else if (ts.isElementAccessExpression(current)) {
    const name = staticStringPropertyName(current.argumentExpression);
    if (name !== undefined) {
      symbol = checker.getPropertyOfType(
        checker.getTypeAtLocation(current.expression),
        name,
      );
    }
  }
  if (!symbol || seen.has(symbol)) return false;
  return isDbExecSymbol(symbol, checker, sourceFile, seen);
}

function isDbExecType(
  type: ts.TypeNode,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (isImportedDbExecType(type, checker, sourceFile)) return true;
  if (
    !ts.isTypeReferenceNode(type) ||
    !ts.isIdentifier(type.typeName) ||
    type.typeName.text !== "ReturnType"
  ) {
    return false;
  }
  const typeArgument = type.typeArguments?.[0];
  return (
    typeArgument !== undefined &&
    ts.isTypeQueryNode(typeArgument) &&
    ts.isIdentifier(typeArgument.exprName) &&
    isImportedDbExecFactory(typeArgument.exprName, checker, sourceFile)
  );
}

function isDbExecSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seen: ReadonlySet<ts.Symbol>,
): boolean {
  if (seen.has(symbol)) return false;
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
      if (
        (ts.isPropertyAssignment(declaration) ||
          ts.isPropertyDeclaration(declaration)) &&
        declaration.initializer !== undefined &&
        isDbExecExpression(
          declaration.initializer,
          checker,
          sourceFile,
          nextSeen,
        )
      ) {
        return true;
      }
      if (ts.isShorthandPropertyAssignment(declaration)) {
        const valueSymbol =
          checker.getShorthandAssignmentValueSymbol(declaration);
        if (
          valueSymbol &&
          isDbExecSymbol(valueSymbol, checker, sourceFile, nextSeen)
        ) {
          return true;
        }
      }
      let declaredType: ts.TypeNode | undefined;
      if (
        ts.isGetAccessorDeclaration(declaration) ||
        ts.isMethodDeclaration(declaration) ||
        ts.isMethodSignature(declaration)
      ) {
        declaredType = declaration.type;
      } else if (
        ts.isVariableDeclaration(declaration) ||
        ts.isParameter(declaration) ||
        ts.isPropertyDeclaration(declaration) ||
        ts.isPropertySignature(declaration)
      ) {
        declaredType = declaration.type;
      }
      if (declaredType && isDbExecType(declaredType, checker, sourceFile)) {
        return true;
      }
      return (
        ts.isParameter(declaration) &&
        isDbExecContextParameter(declaration, checker, sourceFile)
      );
    }) ?? false
  );
}

function resolveImportedSourceFile(
  moduleName: string,
  containingFile: string,
): ts.SourceFile | undefined {
  let modulePath: string | undefined;
  if (moduleName.startsWith(".")) {
    modulePath = path.resolve(path.dirname(containingFile), moduleName);
  } else if (moduleName.startsWith("@agent-native/core/")) {
    modulePath = path.resolve(
      rootDir,
      "packages/core/src",
      moduleName.slice("@agent-native/core/".length),
    );
  }
  if (!modulePath || !modulePath.startsWith(`${rootDir}${path.sep}`)) {
    return undefined;
  }
  const jsSourcePath = modulePath.replace(/\.(?:mjs|cjs|js|jsx)$/i, (ext) => {
    if (ext === ".mjs") return ".mts";
    if (ext === ".cjs") return ".cts";
    return ext === ".jsx" ? ".tsx" : ".ts";
  });
  const candidates = sourceExtension.test(modulePath)
    ? [jsSourcePath]
    : [
        `${modulePath}.ts`,
        `${modulePath}.tsx`,
        `${modulePath}.mts`,
        `${modulePath}.cts`,
        path.join(modulePath, "index.ts"),
        path.join(modulePath, "index.tsx"),
      ];
  const candidate = candidates.find((fileName) => existsSync(fileName));
  if (!candidate) return undefined;
  return ts.createSourceFile(
    candidate,
    readFileSync(candidate, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(candidate),
  );
}

interface ImportedCallbackSignature {
  parameters: readonly ts.ParameterDeclaration[];
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
}

interface ImportedModuleContext {
  sourceFile: ts.SourceFile;
  checker: ts.TypeChecker;
  signatures: Map<string, ImportedCallbackSignature | null>;
}

const importedModuleContexts = new WeakMap<
  ts.TypeChecker,
  Map<string, ImportedModuleContext | null>
>();

function importedFunctionParameters(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): ImportedCallbackSignature | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  const symbol = checker.getSymbolAtLocation(call.expression);
  if (!symbol) return undefined;
  for (const declaration of symbol.declarations ?? []) {
    if (!ts.isImportSpecifier(declaration)) continue;
    const importedName = declaration.propertyName ?? declaration.name;
    const importClause = declaration.parent.parent;
    if (!ts.isImportClause(importClause)) continue;
    const importDeclaration = importClause.parent;
    if (
      !ts.isImportDeclaration(importDeclaration) ||
      !ts.isStringLiteral(importDeclaration.moduleSpecifier)
    ) {
      continue;
    }
    const moduleName = importDeclaration.moduleSpecifier.text;
    const modulePath = path.resolve(
      path.dirname(sourceFile.fileName),
      moduleName,
    );
    let modules = importedModuleContexts.get(checker);
    if (!modules) {
      modules = new Map();
      importedModuleContexts.set(checker, modules);
    }
    if (!modules.has(modulePath)) {
      const moduleSource = resolveImportedSourceFile(
        moduleName,
        sourceFile.fileName,
      );
      modules.set(
        modulePath,
        moduleSource
          ? {
              sourceFile: moduleSource,
              checker: createChecker(moduleSource),
              signatures: new Map(),
            }
          : null,
      );
    }
    const module = modules.get(modulePath);
    if (!module) continue;
    if (module.signatures.has(importedName.text)) {
      const cached = module.signatures.get(importedName.text);
      if (cached) return cached;
      continue;
    }
    const moduleSource = module.sourceFile;
    const helperChecker = module.checker;
    for (const statement of moduleSource.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === importedName.text &&
        statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        const signature = {
          parameters: statement.parameters,
          checker: helperChecker,
          sourceFile: moduleSource,
        };
        module.signatures.set(importedName.text, signature);
        return signature;
      }
      if (
        !ts.isVariableStatement(statement) ||
        !statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        continue;
      }
      const helper = statement.declarationList.declarations.find(
        (item) =>
          ts.isIdentifier(item.name) && item.name.text === importedName.text,
      );
      if (
        helper?.initializer &&
        (ts.isArrowFunction(helper.initializer) ||
          ts.isFunctionExpression(helper.initializer))
      ) {
        const signature = {
          parameters: helper.initializer.parameters,
          checker: helperChecker,
          sourceFile: moduleSource,
        };
        module.signatures.set(importedName.text, signature);
        return signature;
      }
      if (helper?.type && ts.isFunctionTypeNode(helper.type)) {
        const signature = {
          parameters: helper.type.parameters,
          checker: helperChecker,
          sourceFile: moduleSource,
        };
        module.signatures.set(importedName.text, signature);
        return signature;
      }
    }
    module.signatures.set(importedName.text, null);
  }
  return undefined;
}

function isDbExecCallbackType(
  type: ts.TypeNode | undefined,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (!type || !ts.isFunctionTypeNode(type)) return false;
  const parameter = type.parameters[0];
  return (
    parameter?.type !== undefined &&
    isDbExecType(parameter.type, checker, sourceFile)
  );
}

function isDbExecCallbackArgument(
  call: ts.CallExpression,
  callback: ts.FunctionExpression | ts.ArrowFunction,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  if (!ts.isIdentifier(call.expression)) return false;
  const callbackIndex = call.arguments.indexOf(callback);
  if (callbackIndex < 0) return false;
  const symbol = checker.getSymbolAtLocation(call.expression);
  const importedParameters = importedFunctionParameters(
    call,
    checker,
    sourceFile,
  );
  if (
    isDbExecCallbackType(
      importedParameters?.parameters[callbackIndex]?.type,
      importedParameters?.checker ?? checker,
      importedParameters?.sourceFile ?? sourceFile,
    )
  ) {
    return true;
  }
  return (
    symbol?.declarations?.some((declaration) => {
      let parameters: readonly ts.ParameterDeclaration[] | undefined;
      if (
        ts.isFunctionDeclaration(declaration) ||
        ts.isMethodDeclaration(declaration)
      ) {
        parameters = declaration.parameters;
      } else if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        parameters = declaration.initializer.parameters;
      }
      const parameterType = parameters?.[callbackIndex]?.type;
      return isDbExecCallbackType(parameterType, checker, sourceFile);
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
    !call.arguments.some((argument) => argument === callback)
  ) {
    return false;
  }
  const callbackIndex = call.arguments.indexOf(callback);
  if (isDbExecCallbackArgument(call, callback, checker, sourceFile)) {
    return true;
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

function isPostgresParameterFormatterCall(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): boolean {
  if (!ts.isIdentifier(call.expression)) return false;
  const symbol = checker.getSymbolAtLocation(call.expression);
  const resolvedSymbol =
    symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  return (
    resolvedSymbol?.name === "toPostgresParams" &&
    (resolvedSymbol.declarations?.some(
      (declaration) =>
        ts.isFunctionDeclaration(declaration) &&
        path.resolve(declaration.getSourceFile().fileName) ===
          path.resolve(rootDir, "packages/core/src/db/client.ts"),
    ) ??
      false)
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

type StatementBlock = ts.Block | ts.SourceFile;

const statementBlockCache = new WeakMap<ts.Node, StatementBlock | null>();
const assignmentBlockCache = new WeakMap<ts.Node, StatementBlock | null>();
const enclosingFunctionCache = new WeakMap<
  ts.Node,
  ts.FunctionLikeDeclaration | null
>();
const loopBodyCache = new WeakMap<StatementBlock, boolean>();

function computeStatementBlock(node: ts.Node): StatementBlock | undefined {
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

function statementBlock(node: ts.Node): StatementBlock | undefined {
  if (statementBlockCache.has(node)) {
    return statementBlockCache.get(node) ?? undefined;
  }
  const block = computeStatementBlock(node);
  statementBlockCache.set(node, block ?? null);
  return block;
}

function computeAssignmentBlock(
  assignment: TaintedAssignment,
): StatementBlock | undefined {
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

function assignmentBlock(
  assignment: TaintedAssignment,
): StatementBlock | undefined {
  const node = assignment.node;
  if (assignmentBlockCache.has(node)) {
    return assignmentBlockCache.get(node) ?? undefined;
  }
  const block = computeAssignmentBlock(assignment);
  assignmentBlockCache.set(node, block ?? null);
  return block;
}

function computeEnclosingFunction(
  node: ts.Node,
): ts.FunctionLikeDeclaration | undefined {
  let current = node;
  while (current.parent) {
    current = current.parent;
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

function enclosingFunction(
  node: ts.Node,
): ts.FunctionLikeDeclaration | undefined {
  if (enclosingFunctionCache.has(node)) {
    return enclosingFunctionCache.get(node) ?? undefined;
  }
  const declaration = computeEnclosingFunction(node);
  enclosingFunctionCache.set(node, declaration ?? null);
  return declaration;
}

function isLoopBody(block: ts.Block | ts.SourceFile): boolean {
  const cached = loopBodyCache.get(block);
  if (cached !== undefined) return cached;
  let current: ts.Node = block;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isFunctionLike(parent) || ts.isClassLike(parent)) {
      loopBodyCache.set(block, false);
      return false;
    }
    if (
      ts.isIterationStatement(parent, false) &&
      parent.statement === current
    ) {
      loopBodyCache.set(block, true);
      return true;
    }
    current = parent;
  }
  loopBodyCache.set(block, false);
  return false;
}

function reachingAssignments(
  symbol: ts.Symbol,
  reference: ts.Identifier,
  analysis: SqlAnalysis,
): ReachingAssignments {
  const position = reference.getStart();
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
      assignment.node.getStart() > latestDominating.node.getStart()
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
        assignment.node.getStart() < latestDominating.node.getStart() &&
        enclosingFunction(assignment.node) === referenceFunction;
      const followsReferenceInScope =
        !repeatedBlock &&
        assignment.node.getStart() > position &&
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
  traceTemplateSpans = false,
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
    if (isSafeSqlTag(current.tag, analysis.checker, current.getSourceFile())) {
      return new Set();
    }
    if (!ts.isTemplateExpression(current.template)) return new Set();
    if (!traceTemplateSpans) return new Set([current]);
    return unionSources(
      new Set([current]),
      ...current.template.templateSpans.map((span) =>
        findUnsafeSqlSources(
          span.expression,
          analysis,
          seenSymbols,
          seenFunctions,
        ),
      ),
    );
  }
  if (ts.isTemplateExpression(current)) {
    if (!traceTemplateSpans) return new Set([current]);
    return unionSources(
      new Set([current]),
      ...current.templateSpans.map((span) =>
        findUnsafeSqlSources(
          span.expression,
          analysis,
          seenSymbols,
          seenFunctions,
        ),
      ),
    );
  }
  if (ts.isIdentifier(current)) {
    const symbol = analysis.checker.getSymbolAtLocation(current);
    if (!symbol || seenSymbols.has(symbol)) return new Set();
    if (
      isSqlFragmentDeclaration(
        symbol,
        analysis.checker,
        current.getSourceFile(),
      ) &&
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
    const sourceFile = current.getSourceFile();
    if (isPostgresParameterFormatterCall(current, analysis.checker)) {
      const originalSql = current.arguments[0];
      return originalSql
        ? findUnsafeSqlSources(
            originalSql,
            analysis,
            seenSymbols,
            seenFunctions,
            traceTemplateSpans,
          )
        : new Set();
    }
    if (
      isSafeSqlHelperCall(current, analysis.checker, sourceFile) ||
      isSafeSqlMachineCall(current, analysis.checker, sourceFile)
    ) {
      return new Set();
    }
    const symbol = analysis.checker.getSymbolAtLocation(current.expression);
    const resolvedSymbol =
      symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
        ? analysis.checker.getAliasedSymbol(symbol)
        : symbol;
    const functionSymbols = [symbol, resolvedSymbol].filter(
      (candidate): candidate is ts.Symbol => candidate !== undefined,
    );
    const declarations = functionSymbols.flatMap((candidate) => {
      const localDeclarations = analysis.functions.get(candidate);
      if (localDeclarations) return localDeclarations;
      return (candidate.declarations ?? []).flatMap((declaration) => {
        if (
          ts.isFunctionLike(declaration) &&
          "body" in declaration &&
          declaration.body !== undefined
        ) {
          return [declaration];
        }
        if (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer !== undefined
        ) {
          const fn = functionExpression(declaration.initializer);
          return fn ? [fn] : [];
        }
        if (ts.isPropertyAssignment(declaration)) {
          const fn = functionExpression(declaration.initializer);
          return fn ? [fn] : [];
        }
        return [];
      });
    });
    if (resolvedSymbol && declarations.length > 0) {
      if (seenFunctions.has(resolvedSymbol)) return new Set();
      const nextFunctions = new Set(seenFunctions);
      nextFunctions.add(resolvedSymbol);
      return unionSources(
        ...[...new Set(declarations)].flatMap((declaration) =>
          returnExpressions(declaration).map((returned) => {
            const sources = findUnsafeSqlSources(
              returned,
              analysis.relatedAnalyses?.get(returned.getSourceFile()) ??
                analysis,
              seenSymbols,
              nextFunctions,
            );
            return sources.size > 0
              ? unionSources(sources, new Set([returned]))
              : sources;
          }),
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
      if (sources.size > 0) return unionSources(sources, new Set([current]));
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

export interface RawSqlGuardSource {
  source: string;
  addedLines: ReadonlySet<number>;
}

export function findRawSqlInterpolationViolations(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): RawSqlInterpolationFinding[] {
  return findRawSqlInterpolationViolationsInSources(
    new Map([[file, { source, addedLines }]]),
  );
}

export function findRawSqlInterpolationViolationsInSources(
  inputs: ReadonlyMap<string, RawSqlGuardSource>,
): RawSqlInterpolationFinding[] {
  const sourceFiles = new Map<string, ts.SourceFile>();
  const sources = new Map<string, string>();
  const addedByPath = new Map<string, readonly number[]>();
  const linesByPath = new Map<string, string[]>();

  for (const [file, input] of inputs) {
    const normalizedFile = file.replaceAll("\\", "/");
    if (
      !sourceExtension.test(normalizedFile) ||
      generatedPath.test(normalizedFile)
    ) {
      continue;
    }

    const absoluteFile = path.isAbsolute(file)
      ? path.resolve(file)
      : path.resolve(rootDir, file);
    const sourceFile = ts.createSourceFile(
      absoluteFile,
      input.source,
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

    sourceFiles.set(absoluteFile, sourceFile);
    sources.set(absoluteFile, input.source);
    addedByPath.set(
      absoluteFile,
      [...input.addedLines].sort((left, right) => left - right),
    );
  }

  if (sourceFiles.size === 0) return [];

  const program = createProgram([...sourceFiles.values()]);
  const checker = program.getTypeChecker();
  const analyses = new Map<ts.SourceFile, SqlAnalysis>();
  for (const sourceFile of sourceFiles.values()) {
    analyses.set(sourceFile, buildSqlAnalysis(sourceFile, checker));
  }
  for (const analysis of analyses.values()) {
    analysis.relatedAnalyses = analyses;
  }

  const findings: RawSqlInterpolationFinding[] = [];
  const reportedLines = new Set<string>();
  const linesFor = (sourceFile: ts.SourceFile): string[] => {
    const filePath = path.resolve(sourceFile.fileName);
    const cached = linesByPath.get(filePath);
    if (cached) return cached;
    const text = sources.get(filePath) ?? sourceFile.text;
    const lines = text.split(/\r?\n/);
    linesByPath.set(filePath, lines);
    return lines;
  };
  const touchesAddedLines = (node: ts.Node) => {
    const sourceFile = node.getSourceFile();
    const addedLines = addedByPath.get(path.resolve(sourceFile.fileName));
    if (!addedLines || addedLines.length === 0) return false;
    const startLine = lineNumberAt(sourceFile, node.getStart(sourceFile));
    const endLine = lineNumberAt(sourceFile, node.end);
    let lower = 0;
    let upper = addedLines.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      const line = addedLines[middle];
      if (line !== undefined && line < startLine) lower = middle + 1;
      else upper = middle;
    }
    const firstLine = addedLines[lower];
    return firstLine !== undefined && firstLine <= endLine;
  };

  const reportIfAdded = (node: ts.Node) => {
    const sourceFile = node.getSourceFile();
    const startLine = lineNumberAt(sourceFile, node.getStart(sourceFile));
    const endLine = lineNumberAt(sourceFile, node.end);
    const filePath = path.resolve(sourceFile.fileName);
    const lines = linesFor(sourceFile);
    if (!touchesAddedLines(node) || hasPragma(lines, startLine, endLine))
      return;
    const file = path.relative(rootDir, filePath).replace(/\\/g, "/");
    const key = `${file}:${startLine}`;
    if (reportedLines.has(key)) return;
    reportedLines.add(key);
    findings.push({
      file,
      line: startLine,
      snippet: (lines[startLine - 1] ?? "").trim().slice(0, 160),
    });
  };

  const reportUnsafeSqlValue = (
    analysis: SqlAnalysis,
    sink: ts.Node,
    value: ts.Expression,
  ) => {
    const sinkFile = sink.getSourceFile();
    const sinkLines = linesFor(sinkFile);
    if (
      hasPragma(
        sinkLines,
        lineNumberAt(sinkFile, sink.getStart(sinkFile)),
        lineNumberAt(sinkFile, sink.end),
      )
    ) {
      return;
    }
    const unsafeSources = findUnsafeSqlSources(
      value,
      analysis,
      new Set(),
      new Set(),
      true,
    );
    if (unsafeSources.size === 0) return;

    let directValue = value;
    while (
      ts.isParenthesizedExpression(directValue) ||
      ts.isAsExpression(directValue) ||
      ts.isSatisfiesExpression(directValue) ||
      ts.isTypeAssertionExpression(directValue) ||
      ts.isNonNullExpression(directValue) ||
      ts.isAwaitExpression(directValue)
    ) {
      directValue = directValue.expression;
    }
    if (
      (ts.isTemplateExpression(directValue) ||
        ts.isTaggedTemplateExpression(directValue)) &&
      touchesAddedLines(directValue)
    ) {
      reportIfAdded(directValue);
      return;
    }

    const changedSources = [...unsafeSources].filter(touchesAddedLines);
    if (changedSources.length === 0) {
      reportIfAdded(sink);
      return;
    }
    for (const source of changedSources) reportIfAdded(source);
  };

  for (const sourceFile of sourceFiles.values()) {
    const analysis = analyses.get(sourceFile);
    if (!analysis) continue;
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && isSqlPropertyName(node.name)) {
        reportUnsafeSqlValue(analysis, node, node.initializer);
      }
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === "sql") {
        reportUnsafeSqlValue(analysis, node, node.name);
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
        if (argument) reportUnsafeSqlValue(analysis, node, argument);
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        isSqlPropertyAccess(node.left)
      ) {
        reportUnsafeSqlValue(analysis, node, node.right);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return findings;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
  );
}

function intersectsLines(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  lines: ReadonlySet<number>,
): boolean {
  const startLine = lineNumberAt(sourceFile, node.getStart(sourceFile));
  const endLine = lineNumberAt(sourceFile, node.end);
  for (const line of lines) {
    if (line >= startLine && line <= endLine) return true;
  }
  return false;
}

function isStringTypeNode(
  type: ts.TypeNode | undefined,
  stringTypeNames: ReadonlySet<string>,
  checker: ts.TypeChecker,
): boolean {
  if (!type) return false;
  if (mayBeStringType(checker.getTypeAtLocation(type))) return true;
  if (type.kind === ts.SyntaxKind.StringKeyword) return true;
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) {
    return true;
  }
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    return type.types.some((member) =>
      isStringTypeNode(member, stringTypeNames, checker),
    );
  }
  if (ts.isParenthesizedTypeNode(type)) {
    return isStringTypeNode(type.type, stringTypeNames, checker);
  }
  return (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    stringTypeNames.has(type.typeName.text)
  );
}

function hasReturnedStringValue(
  declaration: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): boolean {
  const returns = returnExpressions(declaration);
  if (returns.length === 0) return false;

  const stringTypeNames = new Set<string>(["String"]);
  for (const typeParameter of declaration.typeParameters ?? []) {
    if (isStringTypeNode(typeParameter.constraint, stringTypeNames, checker)) {
      stringTypeNames.add(typeParameter.name.text);
    }
  }
  if (isStringTypeNode(declaration.type, stringTypeNames, checker)) return true;

  const stringParameters = new Set<string>();
  for (const parameter of declaration.parameters) {
    if (
      ts.isIdentifier(parameter.name) &&
      isStringTypeNode(parameter.type, stringTypeNames, checker)
    ) {
      stringParameters.add(parameter.name.text);
    }
  }

  const localDeclarations = new Map<string, ts.VariableDeclaration>();
  const localWrites = new Map<string, ts.Expression[]>();
  const body = declaration.body;
  if (body && ts.isBlock(body)) {
    const collect = (node: ts.Node) => {
      if (node !== body && ts.isFunctionLike(node)) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        localDeclarations.set(node.name.text, node);
      }
      ts.forEachChild(node, collect);
    };
    collect(body);

    const collectWrites = (node: ts.Node) => {
      if (node !== body && ts.isFunctionLike(node)) return;
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isIdentifier(node.left) &&
        localDeclarations.has(node.left.text)
      ) {
        const writes = localWrites.get(node.left.text) ?? [];
        writes.push(node.right);
        localWrites.set(node.left.text, writes);
      }
      ts.forEachChild(node, collectWrites);
    };
    collectWrites(body);
  }

  const stringMethods = new Set([
    "concat",
    "join",
    "padEnd",
    "padStart",
    "replace",
    "replaceAll",
    "slice",
    "substring",
    "toLowerCase",
    "toString",
    "toUpperCase",
    "trim",
  ]);
  const includesStringSource = (
    expression: ts.Expression,
    seen = new Set<ts.Node>(),
  ): boolean => {
    let node = expression;
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node)
    ) {
      node = node.expression;
    }
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isTemplateExpression(node)) return true;
    if (ts.isTaggedTemplateExpression(node)) {
      return !isSafeSqlTag(node.tag, checker, sourceFile);
    }
    if (ts.isIdentifier(node)) {
      if (stringParameters.has(node.text)) return true;
      const declaration = localDeclarations.get(node.text);
      if (!declaration) return false;
      if (isStringTypeNode(declaration.type, stringTypeNames, checker)) {
        return true;
      }
      const expressions = [
        ...(declaration.initializer ? [declaration.initializer] : []),
        ...(localWrites.get(node.text) ?? []),
      ];
      return expressions.some((source) => includesStringSource(source, seen));
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      return true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "String"
    ) {
      return true;
    }
    if (
      ts.isCallExpression(node) &&
      (checker.getTypeAtLocation(node).flags & ts.TypeFlags.StringLike) !== 0
    ) {
      return true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      stringMethods.has(node.expression.name.text)
    ) {
      return true;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return (
        includesStringSource(node.left, seen) ||
        includesStringSource(node.right, seen)
      );
    }
    if (ts.isConditionalExpression(node)) {
      return (
        includesStringSource(node.whenTrue, seen) ||
        includesStringSource(node.whenFalse, seen)
      );
    }
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          isSqlPropertyName(property.name) &&
          includesStringSource(property.initializer, seen),
      );
    }
    return false;
  };

  return returns.some((expression) => includesStringSource(expression));
}

export function findChangedSqlHelperExports(
  source: string,
  file: string,
  addedLines: ReadonlySet<number>,
): Set<string> {
  const sourceFile = ts.createSourceFile(
    path.resolve(file),
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const checker = createChecker(sourceFile);
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      intersectsLines(statement, sourceFile, addedLines) &&
      hasReturnedStringValue(statement, checker, sourceFile)
    ) {
      names.add(statement.name.text);
    }
    if (
      ts.isVariableStatement(statement) &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.initializer === undefined
        ) {
          continue;
        }
        const fn = functionExpression(declaration.initializer);
        if (
          fn &&
          intersectsLines(declaration, sourceFile, addedLines) &&
          hasReturnedStringValue(fn, checker, sourceFile)
        ) {
          names.add(declaration.name.text);
        }
      }
    }
  }
  return names;
}

function gitGrepMatches(names: readonly string[]): string[] {
  const pattern = names
    .map((name) => name.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"))
    .join("|");
  try {
    const result = execFileSync(
      "git",
      [
        "grep",
        "--files-with-matches",
        "--word-regexp",
        "--extended-regexp",
        "-e",
        pattern,
        "--",
        ":(glob)**/*.ts",
        ":(glob)**/*.tsx",
        ":(glob)**/*.mts",
        ":(glob)**/*.cts",
      ],
      { cwd: rootDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return result
      .split(/\r?\n/)
      .filter((match) => match.length > 0)
      .map((match) => path.resolve(rootDir, match));
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 1
    ) {
      return [];
    }
    throw error;
  }
}

function addChangedSqlHelperCallers(
  sources: Map<string, RawSqlGuardSource>,
): void {
  const helperNames = new Set<string>();
  for (const [file, input] of sources) {
    if (input.addedLines.size === 0) continue;
    for (const name of findChangedSqlHelperExports(
      input.source,
      file,
      input.addedLines,
    )) {
      helperNames.add(name);
    }
  }
  if (helperNames.size === 0) return;

  const names = [...helperNames];
  const candidateFiles = new Set<string>();
  for (let offset = 0; offset < names.length; offset += 80) {
    const batch = names.slice(offset, offset + 80);
    for (const file of gitGrepMatches(batch)) {
      candidateFiles.add(path.resolve(rootDir, file));
    }
  }

  for (const file of candidateFiles) {
    if (
      generatedPath.test(path.relative(rootDir, file).replace(/\\/g, "/")) ||
      sources.has(file)
    ) {
      continue;
    }
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `could not read ${path.relative(rootDir, file)}: ${message}`,
      );
    }
    sources.set(file, { source, addedLines: new Set() });
  }
}

function main() {
  const added = requireAddedLines(rootDir, "guard:no-raw-sql-interpolation");
  const sources = new Map<string, RawSqlGuardSource>();

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

    sources.set(absolutePath, { source, addedLines });
  }

  let findings: RawSqlInterpolationFinding[];
  try {
    addChangedSqlHelperCallers(sources);
    findings = findRawSqlInterpolationViolationsInSources(sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`guard:no-raw-sql-interpolation: ${message}`);
    process.exit(2);
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
