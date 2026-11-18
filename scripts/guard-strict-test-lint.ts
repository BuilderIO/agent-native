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

export function findStrictTestIssues(
  file: string,
  text: string,
  added: Set<number>,
): TestLintFinding[] {
  if (!isHandwrittenSource(file)) return [];
  const { source, checker } = bindSource(file, text);
  if (isGeneratedSource(source)) return [];
  const comments = sourceComments(source);
  const findings: TestLintFinding[] = [];
  const testFile = isTestSource(file);

  const declarationOf = (node: ts.Node) =>
    checker.getSymbolAtLocation(node)?.valueDeclaration ??
    checker.getSymbolAtLocation(node)?.declarations?.[0];
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
    seen = new Set<ts.Node>(),
  ): ts.Expression => {
    node = unwrap(node);
    if (seen.has(node)) return node;
    seen.add(node);
    if (ts.isIdentifier(node)) {
      const declaration = declarationOf(node);
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer
      )
        return valueOf(declaration.initializer, seen);
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
  const imported = (
    node: ts.Node,
  ): { module: string; name: string } | undefined => {
    const declaration = declarationOf(node);
    if (!declaration || !ts.isImportSpecifier(declaration)) return undefined;
    const statement = declaration.parent.parent.parent;
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      return undefined;
    return {
      module: statement.moduleSpecifier.text,
      name: (declaration.propertyName ?? declaration.name).text,
    };
  };
  const namespaceImport = (node: ts.Node): string | undefined => {
    const declaration = declarationOf(node);
    if (!declaration || !ts.isNamespaceImport(declaration)) return undefined;
    const statement = declaration.parent.parent;
    return ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined;
  };
  const importCall = (expression: ts.Expression) => {
    const direct = imported(expression);
    if (direct) return direct;
    const access = member(expression);
    const module = access && namespaceImport(access.object);
    return access && module ? { module, name: access.name } : undefined;
  };
  const resultOf = (node: ts.Node): ts.Expression | undefined => {
    if (ts.isVariableDeclaration(node) && node.initializer)
      return resultOf(valueOf(node.initializer));
    if (
      !ts.isFunctionDeclaration(node) &&
      !ts.isFunctionExpression(node) &&
      !ts.isArrowFunction(node)
    )
      return undefined;
    if (!node.body) return undefined;
    if (!ts.isBlock(node.body)) return node.body;
    const statements = node.body.statements;
    return statements.length === 1 &&
      statements[0] &&
      ts.isReturnStatement(statements[0])
      ? statements[0].expression
      : undefined;
  };
  const isSleep = (
    input: ts.Expression,
    seen = new Set<ts.Node>(),
  ): boolean => {
    const node = valueOf(input);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isCallExpression(node)) {
      const access = member(node.expression);
      if (access?.name === "waitForTimeout") return true;
      const call = importCall(node.expression);
      if (
        call &&
        /^(?:node:)?timers\/promises$/.test(call.module) &&
        call.name === "setTimeout"
      )
        return true;
      if (call && /^(?:sleep|delay)$/.test(call.name)) return true;
      if (
        access?.name === "wait" &&
        imported(access.object)?.name === "scheduler"
      )
        return true;
      if (
        access?.name === "sleep" &&
        ts.isIdentifier(access.object) &&
        access.object.text === "Bun" &&
        !declarationOf(access.object)
      )
        return true;
      const declaration = declarationOf(node.expression);
      const result = declaration && resultOf(declaration);
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
      if (!statement || !ts.isExpressionStatement(statement)) return false;
      body = statement.expression;
    }
    if (!ts.isCallExpression(body)) return false;
    const access = member(body.expression);
    const importedTimer = importCall(body.expression);
    const timer =
      (importedTimer?.name === "setTimeout" &&
        /^(?:node:)?timers$/.test(importedTimer.module)) ||
      (ts.isIdentifier(body.expression) &&
        body.expression.text === "setTimeout" &&
        !declarationOf(body.expression)) ||
      (access?.name === "setTimeout" &&
        ts.isIdentifier(access.object) &&
        /^(?:globalThis|window)$/.test(access.object.text) &&
        !declarationOf(access.object));
    if (!timer) return false;
    const resolve = executor.parameters[0]?.name;
    const handler = body.arguments[0];
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
      const statement = callback.statements[0];
      if (
        callback.statements.length !== 1 ||
        !statement ||
        !ts.isExpressionStatement(statement)
      )
        return false;
      callback = statement.expression;
    }
    return (
      ts.isCallExpression(callback) &&
      checker.getSymbolAtLocation(callback.expression) ===
        checker.getSymbolAtLocation(resolve)
    );
  };
  const fixedSleepException = (node: ts.Node): boolean => {
    let statement = node;
    while (
      !ts.isStatement(statement) &&
      statement.parent &&
      !ts.isSourceFile(statement.parent)
    )
      statement = statement.parent;
    return comments.some((comment) => {
      if (comment.end > statement.getStart(source)) return false;
      const between = source.text.slice(
        comment.end,
        statement.getStart(source),
      );
      return (
        /^[ \t]*\r?\n[ \t]*$/.test(between) &&
        /^fixed-sleep-ok: \S[^\n]{9,}$/.test(commentBody(source, comment))
      );
    });
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
  ) => {
    if (!changedDependency(node)) return;
    findings.push({
      file,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      rule,
      message,
    });
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
    if (ts.isCallExpression(node)) {
      const access = member(node.expression);
      const server = access && valueOf(access.object);
      const factory =
        server &&
        ts.isCallExpression(server) &&
        importCall(valueOf(server.expression));
      if (
        access &&
        factory &&
        /^msw(?:\/|$)/.test(factory.module) &&
        ((factory.name === "setupServer" && access.name === "listen") ||
          (factory.name === "setupWorker" && access.name === "start"))
      ) {
        const options = node.arguments[0] && valueOf(node.arguments[0]);
        let strategy: ts.Expression | undefined;
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (ts.isSpreadAssignment(property)) strategy = undefined;
            else {
              const name = ts.isComputedPropertyName(property.name)
                ? property.name.expression
                : property.name;
              if (!ts.isIdentifier(name) && !ts.isStringLiteralLike(name))
                strategy = undefined;
              else if (
                (ts.isComputedPropertyName(property.name) &&
                  ts.isIdentifier(name)) ||
                name.text === "onUnhandledRequest"
              ) {
                strategy = ts.isPropertyAssignment(property)
                  ? valueOf(property.initializer)
                  : ts.isShorthandPropertyAssignment(property)
                    ? valueOf(property.name)
                    : undefined;
              }
            }
          }
        }
        if (
          !strategy ||
          !ts.isStringLiteralLike(strategy) ||
          strategy.text !== "error"
        ) {
          report(
            node,
            "test/strict-msw",
            'Start MSW with onUnhandledRequest: "error". Use explicit handlers and scoped passthrough for owned local endpoints.',
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}
