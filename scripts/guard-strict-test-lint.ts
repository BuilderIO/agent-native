import ts from "typescript";

import {
  bindSource,
  commentBody,
  isGeneratedSource,
  isHandwrittenSource,
  isTestSource,
  sourceComments,
  touchesAdded,
} from "./lib/guard-source.ts";

export interface TestLintFinding {
  file: string;
  line: number;
  rule: "test/no-fixed-sleep" | "test/strict-msw";
  message: string;
}

const TIMER_PROMISES = /^(?:node:)?timers\/promises$/;
const TIMER_CALLBACKS = /^(?:node:)?timers$/;

export function findStrictTestIssues(
  file: string,
  text: string,
  added: Set<number>,
): TestLintFinding[] {
  if (!isHandwrittenSource(file) || isGeneratedSource(text)) return [];
  const { source, checker } = bindSource(file, text);
  const findings: TestLintFinding[] = [];
  const testFile = isTestSource(file);
  const sleepExemptions = new Map<number, number>();
  if (testFile) {
    for (const comment of sourceComments(source)) {
      if (/^fixed-sleep-ok: \S[^\n]{9,}$/.test(commentBody(text, comment))) {
        const { line } = source.getLineAndCharacterOfPosition(comment.end);
        sleepExemptions.set(line + 1, comment.end);
      }
    }
  }

  const declarationOf = (node: ts.Node) => {
    const parent = node.parent;
    const symbol =
      ts.isShorthandPropertyAssignment(parent) && parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : ts.isExportSpecifier(parent)
          ? checker.getExportSpecifierLocalTargetSymbol(parent)
          : checker.getSymbolAtLocation(node);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  };
  const unwrap = (node: ts.Expression): ts.Expression => {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return unwrap(node.expression);
    return node;
  };
  const valueOf = (
    node: ts.Expression,
    initializerOf = (declaration: ts.VariableDeclaration) =>
      declaration.initializer,
  ): ts.Expression => {
    const seen = new Set<ts.Node>();
    node = unwrap(node);
    while (ts.isIdentifier(node) && !seen.has(node)) {
      seen.add(node);
      const declaration = declarationOf(node);
      if (!declaration || !ts.isVariableDeclaration(declaration)) break;
      const initializer = initializerOf(declaration);
      if (!initializer) break;
      node = unwrap(initializer);
    }
    return node;
  };
  const member = (
    node: ts.Expression,
  ): { object: ts.Expression; name: string } | undefined => {
    if (ts.isPropertyAccessExpression(node))
      return { object: node.expression, name: node.name.text };
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    )
      return { object: node.expression, name: node.argumentExpression.text };
    return undefined;
  };
  const moduleSpecifierOf = (
    binding: ts.ImportSpecifier | ts.NamespaceImport | ts.ImportClause,
  ): ts.StringLiteral | undefined => {
    const statement = ts.isImportSpecifier(binding)
      ? binding.parent.parent.parent
      : ts.isNamespaceImport(binding)
        ? binding.parent.parent
        : binding.parent;
    return ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier
      : undefined;
  };
  const importCall = (expression: ts.Expression) => {
    const direct = declarationOf(expression);
    if (direct && ts.isImportSpecifier(direct)) {
      const module = moduleSpecifierOf(direct);
      if (module)
        return {
          module: module.text,
          name: (direct.propertyName ?? direct.name).text,
        };
    }
    const access = member(expression);
    if (!access) return undefined;
    const binding = declarationOf(valueOf(access.object));
    if (
      !binding ||
      (!ts.isNamespaceImport(binding) && !ts.isImportClause(binding))
    )
      return undefined;
    const module = moduleSpecifierOf(binding);
    if (!module) return undefined;
    if (
      ts.isImportClause(binding) &&
      !TIMER_CALLBACKS.test(module.text) &&
      !TIMER_PROMISES.test(module.text)
    )
      return undefined;
    return { module: module.text, name: access.name };
  };
  const resultOf = (node: ts.Node): ts.Expression | undefined => {
    if (
      !ts.isFunctionDeclaration(node) &&
      !ts.isFunctionExpression(node) &&
      !ts.isArrowFunction(node)
    )
      return undefined;
    if (!node.body) return undefined;
    if (!ts.isBlock(node.body)) return node.body;
    const statements = node.body.statements;
    if (statements.length !== 1) return undefined;
    const statement = statements[0];
    return ts.isReturnStatement(statement) ? statement.expression : undefined;
  };
  const factoryOf = (
    expression: ts.Expression,
    seen = new Set<ts.Node>(),
  ): ReturnType<typeof importCall> => {
    const value = valueOf(expression);
    if (!ts.isCallExpression(value) || seen.has(value)) return undefined;
    seen.add(value);
    const callee = valueOf(value.expression);
    const imported = importCall(callee);
    if (imported) return imported;
    const result = resultOf(declarationOf(callee) ?? callee);
    return result && factoryOf(result, seen);
  };
  const isMswStart = (call: ts.CallExpression): boolean => {
    const access = member(unwrap(call.expression));
    if (!access || (access.name !== "listen" && access.name !== "start"))
      return false;
    const factory = factoryOf(access.object);
    return (
      !!factory &&
      /^msw(?:\/|$)/.test(factory.module) &&
      ((factory.name === "setupServer" && access.name === "listen") ||
        (factory.name === "setupWorker" && access.name === "start"))
    );
  };
  const isSleep = (
    input: ts.Expression,
    seen = new Set<ts.Node>(),
  ): boolean => {
    const node = valueOf(input);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isCallExpression(node)) {
      const callee = valueOf(node.expression);
      const access = member(callee);
      if (access?.name === "waitForTimeout") return true;
      const call = importCall(callee);
      if (call?.name === "setTimeout" && TIMER_PROMISES.test(call.module))
        return true;
      const object = access && valueOf(access.object);
      if (access?.name === "wait" && object) {
        const scheduler = importCall(object);
        if (
          scheduler?.name === "scheduler" &&
          TIMER_PROMISES.test(scheduler.module)
        )
          return true;
      }
      if (
        access?.name === "sleep" &&
        object &&
        ts.isIdentifier(object) &&
        object.text === "Bun" &&
        !declarationOf(object)
      )
        return true;
      const result = resultOf(declarationOf(callee) ?? callee);
      return result ? isSleep(result, seen) : false;
    }
    if (
      !ts.isNewExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== "Promise"
    )
      return false;
    const executor = node.arguments?.[0];
    if (
      !executor ||
      (!ts.isArrowFunction(executor) && !ts.isFunctionExpression(executor))
    )
      return false;
    let body: ts.Node = executor.body;
    if (ts.isBlock(body)) {
      if (body.statements.length !== 1) return false;
      const statement = body.statements[0];
      if (!ts.isExpressionStatement(statement)) return false;
      body = statement.expression;
    }
    if (!ts.isCallExpression(body)) return false;
    const callee = valueOf(body.expression);
    const access = member(callee);
    const importedTimer = importCall(callee);
    const timer =
      (importedTimer?.name === "setTimeout" &&
        TIMER_CALLBACKS.test(importedTimer.module)) ||
      (ts.isIdentifier(callee) &&
        callee.text === "setTimeout" &&
        !declarationOf(callee)) ||
      (access?.name === "setTimeout" &&
        ts.isIdentifier(access.object) &&
        /^(?:globalThis|window)$/.test(access.object.text) &&
        !declarationOf(access.object));
    if (!timer) return false;
    const resolve = executor.parameters.at(0)?.name;
    const handler = body.arguments.at(0);
    if (!resolve || !handler || !ts.isIdentifier(resolve)) return false;
    if (ts.isIdentifier(handler))
      return (
        checker.getSymbolAtLocation(handler) ===
        checker.getSymbolAtLocation(resolve)
      );
    if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))
      return false;
    let callback: ts.Node = handler.body;
    if (ts.isBlock(callback)) {
      if (callback.statements.length !== 1) return false;
      const statement = callback.statements[0];
      if (!ts.isExpressionStatement(statement)) return false;
      callback = statement.expression;
    }
    return (
      ts.isCallExpression(callback) &&
      checker.getSymbolAtLocation(callback.expression) ===
        checker.getSymbolAtLocation(resolve)
    );
  };
  const statementOf = (node: ts.Node): ts.Node => {
    let statement = node;
    while (!ts.isStatement(statement) && !ts.isSourceFile(statement.parent))
      statement = statement.parent;
    return statement;
  };
  const fixedSleepException = (node: ts.Node): boolean => {
    const start = statementOf(node).getStart(source);
    const { line } = source.getLineAndCharacterOfPosition(start);
    const end = sleepExemptions.get(line);
    return (
      end !== undefined && /^[ \t]*\r?\n[ \t]*$/.test(text.slice(end, start))
    );
  };
  const changedDependency = (
    node: ts.Node,
    seen = new Set<ts.Node>(),
  ): boolean => {
    if (seen.has(node)) return false;
    seen.add(node);
    if (
      touchesAdded(source, { pos: node.getStart(source), end: node.end }, added)
    )
      return true;
    if (
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node) ||
      ts.isImportClause(node)
    ) {
      const module = moduleSpecifierOf(node);
      return module !== undefined && changedDependency(module, seen);
    }
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      if (
        declaration &&
        declaration.getSourceFile() === source &&
        changedDependency(declaration, seen)
      )
        return true;
    }
    return (
      ts.forEachChild(node, (child) => changedDependency(child, seen)) ?? false
    );
  };
  const report = (
    node: ts.Node,
    rule: TestLintFinding["rule"],
    message: string,
    dependencies: Iterable<ts.Node> = [],
  ) => {
    if (
      ![node, ...dependencies].some((dependency) =>
        changedDependency(dependency),
      )
    )
      return;
    findings.push({
      file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      rule,
      message,
    });
  };
  const isConst = (declaration: ts.VariableDeclaration): boolean =>
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0;

  let localReferences: Map<ts.VariableDeclaration, ts.Identifier[]> | undefined;
  const referencesTo = (binding: ts.VariableDeclaration) => {
    if (!localReferences) {
      const references = new Map<ts.VariableDeclaration, ts.Identifier[]>();
      const index = (node: ts.Node) => {
        if (ts.isIdentifier(node)) {
          const declaration = declarationOf(node);
          if (
            declaration &&
            ts.isVariableDeclaration(declaration) &&
            declaration.name !== node
          ) {
            const uses = references.get(declaration);
            if (uses) uses.push(node);
            else references.set(declaration, [node]);
          }
        }
        ts.forEachChild(node, index);
      };
      index(source);
      localReferences = references;
    }
    return localReferences.get(binding) ?? [];
  };
  const strictMswOptions = (argument: ts.Expression | undefined) => {
    const dependencies = new Set<ts.Node>();
    const bindings = new Set<ts.VariableDeclaration>();
    const inspect = (declaration: ts.VariableDeclaration) => {
      if (bindings.has(declaration)) return;
      bindings.add(declaration);
      if (
        !isConst(declaration) ||
        (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Export) !==
          0
      )
        dependencies.add(declaration);
      for (const reference of referencesTo(declaration)) {
        let expression: ts.Expression = reference;
        while (
          ts.isExpression(expression.parent) &&
          unwrap(expression.parent) === reference
        )
          expression = expression.parent;
        const parent = expression.parent;
        if (
          ts.isCallExpression(parent) &&
          parent.arguments[0] === expression &&
          isMswStart(parent)
        )
          continue;
        if (
          ts.isVariableDeclaration(parent) &&
          parent.initializer === expression &&
          ts.isIdentifier(parent.name)
        )
          inspect(parent);
        else dependencies.add(statementOf(expression));
      }
    };
    const options =
      argument &&
      valueOf(argument, (declaration) => {
        inspect(declaration);
        return declaration.initializer;
      });
    if (!options || !ts.isObjectLiteralExpression(options) || dependencies.size)
      return { strict: false, dependencies };

    const constant = (expression: ts.Expression) =>
      valueOf(expression, (declaration) => {
        if (isConst(declaration)) return declaration.initializer;
        for (const reference of referencesTo(declaration))
          dependencies.add(statementOf(reference));
        return undefined;
      });
    let strategy: ts.Expression | undefined;
    for (const property of options.properties) {
      if (ts.isSpreadAssignment(property)) {
        strategy = undefined;
        continue;
      }
      const name = property.name;
      const key = ts.isComputedPropertyName(name)
        ? constant(name.expression)
        : name;
      const propertyName =
        ts.isStringLiteralLike(key) ||
        ts.isNumericLiteral(key) ||
        (!ts.isComputedPropertyName(name) && ts.isIdentifier(key))
          ? key.text
          : undefined;
      if (propertyName === undefined) strategy = undefined;
      else if (propertyName === "onUnhandledRequest") {
        strategy = ts.isPropertyAssignment(property)
          ? constant(property.initializer)
          : ts.isShorthandPropertyAssignment(property)
            ? constant(property.name)
            : undefined;
      }
    }
    return {
      strict:
        strategy !== undefined &&
        ts.isStringLiteralLike(strategy) &&
        strategy.text === "error",
      dependencies,
    };
  };
  const visit = (node: ts.Node) => {
    if (
      testFile &&
      ts.isAwaitExpression(node) &&
      isSleep(node.expression) &&
      !fixedSleepException(node)
    ) {
      report(
        node,
        "test/no-fixed-sleep",
        "Await the operation or its completion signal; advance fake timers for time behavior. A deliberate timer subject needs an adjacent // fixed-sleep-ok: <specific reason, 10+ characters>.",
      );
    }
    if (ts.isCallExpression(node) && isMswStart(node)) {
      const { strict, dependencies } = strictMswOptions(node.arguments.at(0));
      if (!strict)
        report(
          node,
          "test/strict-msw",
          'Start MSW with onUnhandledRequest: "error" in inline options or a local const only used to start MSW. Use explicit handlers and scoped passthrough for owned local endpoints.',
          dependencies,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
