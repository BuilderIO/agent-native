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
    dependencies: Set<ts.Node>,
    initializerOf = (declaration: ts.VariableDeclaration) =>
      declaration.initializer,
  ): ts.Expression => {
    const seen = new Set<ts.Node>();
    node = unwrap(node);
    while (ts.isIdentifier(node) && !seen.has(node)) {
      seen.add(node);
      dependencies.add(node);
      const declaration = declarationOf(node);
      if (!declaration || !ts.isVariableDeclaration(declaration)) break;
      dependencies.add(declaration.name);
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
  const importCall = (
    expression: ts.Expression,
    dependencies: Set<ts.Node>,
  ) => {
    const access = member(expression);
    const binding = declarationOf(
      access ? valueOf(access.object, dependencies) : expression,
    );
    if (!binding) return undefined;
    if (!access && ts.isImportSpecifier(binding)) {
      const module = moduleSpecifierOf(binding);
      if (!module) return undefined;
      dependencies.add(binding);
      dependencies.add(module);
      return {
        module: module.text,
        name: (binding.propertyName ?? binding.name).text,
      };
    }
    if (
      !access ||
      (!ts.isNamespaceImport(binding) && !ts.isImportClause(binding))
    )
      return undefined;
    const module = moduleSpecifierOf(binding);
    if (!module) return undefined;
    if (ts.isImportClause(binding)) {
      if (
        !binding.name ||
        (!TIMER_CALLBACKS.test(module.text) &&
          !TIMER_PROMISES.test(module.text))
      )
        return undefined;
      dependencies.add(binding.name);
    } else dependencies.add(binding);
    dependencies.add(module);
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
    dependencies: Set<ts.Node>,
    seen = new Set<ts.Node>(),
  ): ReturnType<typeof importCall> => {
    const value = valueOf(expression, dependencies);
    if (!ts.isCallExpression(value) || seen.has(value)) return undefined;
    seen.add(value);
    const callee = valueOf(value.expression, dependencies);
    dependencies.add(callee);
    const imported = importCall(callee, dependencies);
    if (imported) return imported;
    const result = resultOf(declarationOf(callee) ?? callee);
    return result && factoryOf(result, dependencies, seen);
  };
  const isMswStart = (
    call: ts.CallExpression,
    dependencies = new Set<ts.Node>(),
  ): boolean => {
    const access = member(unwrap(call.expression));
    if (!access || (access.name !== "listen" && access.name !== "start"))
      return false;
    const factory = factoryOf(access.object, dependencies);
    return (
      !!factory &&
      /^msw(?:\/|$)/.test(factory.module) &&
      ((factory.name === "setupServer" && access.name === "listen") ||
        (factory.name === "setupWorker" && access.name === "start"))
    );
  };
  const findCall = (
    node: ts.Node,
    matches: (call: ts.CallExpression) => boolean,
  ): ts.CallExpression | undefined => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return undefined;
    if (ts.isCallExpression(node) && matches(node)) return node;
    return ts.forEachChild(node, (child) => findCall(child, matches));
  };
  const isResolvingTimer = (
    call: ts.CallExpression,
    resolve: ts.Identifier,
    dependencies: Set<ts.Node>,
  ): boolean => {
    const handler = call.arguments.at(0);
    if (!handler) return false;
    const callback = unwrap(handler);
    const resolveBinding = checker.getSymbolAtLocation(resolve);
    const resolves = (expression: ts.Expression) =>
      ts.isIdentifier(expression) &&
      checker.getSymbolAtLocation(expression) === resolveBinding;
    const resolution = resolves(callback)
      ? callback
      : ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)
        ? findCall(callback.body, (node) => resolves(unwrap(node.expression)))
            ?.expression
        : undefined;
    if (!resolution) return false;
    const timerDependencies = new Set<ts.Node>();
    const callee = valueOf(call.expression, timerDependencies);
    const access = member(callee);
    const imported = importCall(callee, timerDependencies);
    const timer =
      (imported?.name === "setTimeout" &&
        TIMER_CALLBACKS.test(imported.module)) ||
      (ts.isIdentifier(callee) &&
        callee.text === "setTimeout" &&
        !declarationOf(callee)) ||
      (access?.name === "setTimeout" &&
        ts.isIdentifier(access.object) &&
        /^(?:globalThis|window)$/.test(access.object.text) &&
        !declarationOf(access.object));
    if (!timer) return false;
    dependencies.add(callee);
    dependencies.add(resolution);
    for (const dependency of timerDependencies) dependencies.add(dependency);
    return true;
  };
  const isSleep = (
    input: ts.Expression,
    dependencies: Set<ts.Node>,
    seen = new Set<ts.Node>(),
  ): boolean => {
    const node = valueOf(input, dependencies);
    if (seen.has(node)) return false;
    seen.add(node);
    if (ts.isCallExpression(node)) {
      const callee = valueOf(node.expression, dependencies);
      dependencies.add(callee);
      const access = member(callee);
      if (access?.name === "waitForTimeout") return true;
      const call = importCall(callee, dependencies);
      if (call?.name === "setTimeout" && TIMER_PROMISES.test(call.module))
        return true;
      const object = access && valueOf(access.object, dependencies);
      if (access?.name === "wait" && object) {
        const scheduler = importCall(object, dependencies);
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
      return result ? isSleep(result, dependencies, seen) : false;
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
    const resolve = executor.parameters.at(0)?.name;
    dependencies.add(node.expression);
    if (!resolve || !ts.isIdentifier(resolve)) return false;
    dependencies.add(resolve);
    return (
      findCall(executor.body, (call) =>
        isResolvingTimer(call, resolve, dependencies),
      ) !== undefined
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
  const report = (
    node: ts.Node,
    rule: TestLintFinding["rule"],
    message: string,
    dependencies: Iterable<ts.Node> = [],
  ) => {
    if (
      ![node, ...dependencies].some((dependency) =>
        touchesAdded(
          source,
          { pos: dependency.getStart(source), end: dependency.end },
          added,
        ),
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
  const strictMswOptions = (
    argument: ts.Expression | undefined,
    dependencies: Set<ts.Node>,
  ): boolean => {
    const unsafe = new Set<ts.Node>();
    const bindings = new Set<ts.VariableDeclaration>();
    const inspect = (declaration: ts.VariableDeclaration) => {
      if (bindings.has(declaration)) return;
      bindings.add(declaration);
      if (
        !isConst(declaration) ||
        (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Export) !==
          0
      )
        unsafe.add(declaration.name);
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
        else unsafe.add(statementOf(expression));
      }
    };
    const options =
      argument &&
      valueOf(argument, dependencies, (declaration) => {
        inspect(declaration);
        return declaration.initializer;
      });
    if (unsafe.size) {
      for (const dependency of unsafe) dependencies.add(dependency);
      return false;
    }
    if (!options || !ts.isObjectLiteralExpression(options)) {
      if (options) dependencies.add(options);
      return false;
    }

    const constant = (expression: ts.Expression) => {
      const value = valueOf(expression, dependencies, (declaration) => {
        if (isConst(declaration)) return declaration.initializer;
        for (const reference of referencesTo(declaration))
          dependencies.add(statementOf(reference));
        return undefined;
      });
      dependencies.add(value.getFirstToken(source) ?? value);
      return value;
    };
    const optionNames: ts.PropertyName[] = [];
    for (const property of options.properties.toReversed()) {
      if (ts.isSpreadAssignment(property)) {
        dependencies.add(property);
        return false;
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
      if (propertyName === undefined) return false;
      if (propertyName !== "onUnhandledRequest") {
        optionNames.push(name);
        continue;
      }
      dependencies.add(name);
      const strategy = ts.isPropertyAssignment(property)
        ? constant(property.initializer)
        : ts.isShorthandPropertyAssignment(property)
          ? constant(property.name)
          : undefined;
      return (
        strategy !== undefined &&
        ts.isStringLiteralLike(strategy) &&
        strategy.text === "error"
      );
    }
    for (const name of optionNames) dependencies.add(name);
    return false;
  };
  const visit = (node: ts.Node) => {
    if (testFile && ts.isAwaitExpression(node) && !fixedSleepException(node)) {
      const dependencies = new Set<ts.Node>();
      if (isSleep(node.expression, dependencies))
        report(
          node,
          "test/no-fixed-sleep",
          "Await the operation or its completion signal; advance fake timers for time behavior. A deliberate timer subject needs an adjacent // fixed-sleep-ok: <specific reason, 10+ characters>.",
          dependencies,
        );
    }
    if (ts.isCallExpression(node)) {
      const dependencies = new Set<ts.Node>();
      if (
        isMswStart(node, dependencies) &&
        !strictMswOptions(node.arguments.at(0), dependencies)
      )
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
