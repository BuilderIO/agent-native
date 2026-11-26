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
const TEST_RUNNERS = new Set([
  "vitest",
  "@playwright/test",
  "node:test",
  "bun:test",
  "@jest/globals",
  "mocha",
]);
const TEST_CASES = new Set(["test", "it", "specify"]);
const TEST_HOOKS = new Set([
  "before",
  "after",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);
const TEST_MODIFIERS = new Set(["only", "concurrent", "sequential", "fails"]);

interface ImportReference {
  module: string;
  members: readonly string[];
}

export function findStrictTestIssues(
  file: string,
  text: string,
  added: Set<number>,
): TestLintFinding[] {
  if (!isHandwrittenSource(file) || isGeneratedSource(text)) return [];
  const { source, checker } = bindSource(file, text);
  const findings: TestLintFinding[] = [];
  const reported = new Set<ts.Node>();
  const testFile = isTestSource(file);
  const sleepExemptions = new Map<number, number>();
  if (testFile) {
    for (const comment of sourceComments(source)) {
      if (/^fixed-sleep-ok: \S[^\n]{9,}$/.test(commentBody(text, comment))) {
        const { character } = source.getLineAndCharacterOfPosition(comment.pos);
        if (text.slice(comment.pos - character, comment.pos).trim()) continue;
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
  const fromImport = (
    expression: ts.Expression,
    dependencies: Set<ts.Node>,
    seen = new Set<ts.Node>(),
  ): ImportReference | undefined => {
    const value = valueOf(expression, dependencies);
    if (seen.has(value)) return undefined;
    seen.add(value);

    const access = member(value);
    if (access) {
      const origin = fromImport(access.object, dependencies, seen);
      if (!origin) return undefined;
      dependencies.add(value);
      return {
        module: origin.module,
        members: [...origin.members, access.name],
      };
    }
    const binding = declarationOf(value);
    if (!binding) return undefined;
    if (ts.isBindingElement(binding)) {
      const members: string[] = [];
      let element = binding;
      for (;;) {
        const pattern = element.parent;
        if (
          !ts.isObjectBindingPattern(pattern) ||
          element.initializer ||
          element.dotDotDotToken
        )
          return undefined;
        const key = element.propertyName ?? element.name;
        if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key))
          return undefined;
        dependencies.add(key);
        dependencies.add(element.name.getFirstToken(source) ?? element.name);
        members.unshift(key.text);
        const owner = pattern.parent;
        if (ts.isBindingElement(owner)) {
          element = owner;
          continue;
        }
        if (!ts.isVariableDeclaration(owner) || !owner.initializer)
          return undefined;
        const origin = fromImport(owner.initializer, dependencies, seen);
        return (
          origin && {
            module: origin.module,
            members: [...origin.members, ...members],
          }
        );
      }
    }
    if (
      !ts.isImportSpecifier(binding) &&
      !ts.isNamespaceImport(binding) &&
      !ts.isImportClause(binding)
    )
      return undefined;
    const module = moduleSpecifierOf(binding);
    if (!module) return undefined;
    const name = ts.isImportSpecifier(binding)
      ? (binding.propertyName ?? binding.name).text
      : ts.isImportClause(binding)
        ? "default"
        : undefined;
    const anchor = ts.isImportClause(binding) ? binding.name : binding;
    if (!anchor) return undefined;
    dependencies.add(anchor);
    dependencies.add(module);
    if (name === "default") {
      if (TIMER_CALLBACKS.test(module.text) || TIMER_PROMISES.test(module.text))
        return { module: module.text, members: [] };
      if (module.text === "node:test")
        return { module: module.text, members: ["test"] };
    }
    return { module: module.text, members: name ? [name] : [] };
  };
  const bodyOf = (node: ts.Node) =>
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
      ? node.body
      : undefined;
  const resultOf = (node: ts.Node): ts.Expression | undefined => {
    const body = bodyOf(node);
    if (!body || !ts.isBlock(body)) return body;
    const statements = body.statements;
    if (statements.length !== 1) return undefined;
    const statement = statements[0];
    return ts.isReturnStatement(statement) ? statement.expression : undefined;
  };
  const factoryOf = (
    expression: ts.Expression,
    dependencies: Set<ts.Node>,
    seen = new Set<ts.Node>(),
  ): ImportReference | undefined => {
    const value = valueOf(expression, dependencies);
    if (!ts.isCallExpression(value) || seen.has(value)) return undefined;
    seen.add(value);
    const callee = valueOf(value.expression, dependencies);
    dependencies.add(callee);
    const imported = fromImport(callee, dependencies);
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
      factory.members.length === 1 &&
      ((factory.members[0] === "setupServer" && access.name === "listen") ||
        (factory.members[0] === "setupWorker" && access.name === "start"))
    );
  };
  const walkBody = <T>(
    node: ts.Node,
    inspect: (node: ts.Node) => T | undefined,
  ): T | undefined => {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return undefined;
    return (
      inspect(node) ??
      ts.forEachChild(node, (child) => walkBody(child, inspect))
    );
  };
  const findCall = (
    node: ts.Node,
    matches: (call: ts.CallExpression) => boolean,
  ) =>
    walkBody(node, (child) =>
      ts.isCallExpression(child) && matches(child) ? child : undefined,
    );
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
    const imported = fromImport(callee, timerDependencies);
    const timer =
      (imported?.members.length === 1 &&
        imported.members[0] === "setTimeout" &&
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
      const call = fromImport(callee, dependencies);
      if (call && TIMER_PROMISES.test(call.module)) {
        const [name, method] = call.members;
        if (
          (call.members.length === 1 && name === "setTimeout") ||
          (call.members.length === 2 &&
            name === "scheduler" &&
            method === "wait")
        )
          return true;
      }
      if (access?.name === "sleep") {
        const object = valueOf(access.object, dependencies);
        if (
          ts.isIdentifier(object) &&
          object.text === "Bun" &&
          !declarationOf(object)
        )
          return true;
      }
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
  const isRunnerCall = (
    call: ts.CallExpression,
    dependencies: Set<ts.Node>,
  ): boolean => {
    const target = valueOf(call.expression, dependencies);
    const builder = ts.isCallExpression(target)
      ? target.expression
      : ts.isTaggedTemplateExpression(target)
        ? target.tag
        : undefined;
    const callee = builder ? valueOf(builder, dependencies) : target;
    const imported = fromImport(callee, dependencies);
    let members: readonly string[];
    if (imported) {
      if (!TEST_RUNNERS.has(imported.module)) return false;
      members = imported.members;
    } else {
      const access = member(callee);
      const root = access ? valueOf(access.object, dependencies) : callee;
      if (!ts.isIdentifier(root) || declarationOf(root)) return false;
      dependencies.add(callee);
      members = access ? [root.text, access.name] : [root.text];
    }

    const [name, ...methods] = members;
    if (!name) return false;
    if (builder) {
      const method = methods.at(-1);
      return (
        TEST_CASES.has(name) &&
        (method === "each" || method === "for") &&
        methods.slice(0, -1).every((item) => TEST_MODIFIERS.has(item))
      );
    }
    if (!methods.length) return TEST_CASES.has(name) || TEST_HOOKS.has(name);
    const method = methods.at(0);
    if (name === "test" && methods.length === 1 && method) {
      if (TEST_HOOKS.has(method)) return true;
      if (method === "step" && imported?.module === "@playwright/test")
        return true;
    }
    return (
      TEST_CASES.has(name) && methods.every((item) => TEST_MODIFIERS.has(item))
    );
  };
  const reportSleep = (
    node: ts.Node,
    expression: ts.Expression,
    context: Iterable<ts.Node> = [],
  ) => {
    if (fixedSleepException(node)) return;
    const dependencies = new Set(context);
    if (isSleep(expression, dependencies))
      report(
        node,
        "test/no-fixed-sleep",
        "Await the operation or its completion signal; advance fake timers for time behavior. A deliberate timer subject needs an adjacent // fixed-sleep-ok: <specific reason, 10+ characters>.",
        dependencies,
      );
  };
  const checkRunnerReturns = (call: ts.CallExpression) => {
    for (const argument of call.arguments.toReversed()) {
      const dependencies = new Set<ts.Node>();
      const value = valueOf(argument, dependencies, (declaration) =>
        isConst(declaration) ? declaration.initializer : undefined,
      );
      const callback = ts.isIdentifier(value) ? declarationOf(value) : value;
      if (!callback) continue;
      const body = bodyOf(callback);
      if (!body) continue;
      if (!isRunnerCall(call, dependencies)) return;
      if (ts.isFunctionDeclaration(callback) && callback.name)
        dependencies.add(callback.name);
      if (ts.isBlock(body)) {
        walkBody(body, (node) => {
          if (ts.isReturnStatement(node) && node.expression)
            reportSleep(node, node.expression, dependencies);
          return undefined;
        });
      } else {
        reportSleep(body, body, dependencies);
      }
      return;
    }
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
      reported.has(node) ||
      ![node, ...dependencies].some((dependency) =>
        touchesAdded(
          source,
          { pos: dependency.getStart(source), end: dependency.end },
          added,
        ),
      )
    )
      return;
    reported.add(node);
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
    if (testFile && ts.isAwaitExpression(node))
      reportSleep(node, node.expression);
    if (ts.isCallExpression(node)) {
      if (testFile) checkRunnerReturns(node);
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
