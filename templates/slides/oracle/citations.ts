import { parseSync } from "@swc/core";

// Letter families (T, H, V, P, E, O, F, K) must match as well as digits; a
// digit-only pattern would drop their citations without any failure.
const CITATION_PATTERN =
  /\boracle ((?:\d+|[A-Z])\.\d+[a-z]?|G\.[a-z0-9][a-z0-9.-]*)\b/g;

// The functions Vitest declares tests with, as globals or as named imports.
// suite is describe under another name.
const TEST_FUNCTIONS = new Set(["it", "test", "describe", "suite"]);
// The keys of an options object that set a test's mode.
const OPTION_MODES = new Set(["skip", "only", "todo"]);
const TEST_MODIFIERS = new Set([
  "shuffle",
  "only",
  "skip",
  "todo",
  "each",
  "for",
  "concurrent",
  "fails",
  "sequential",
  "skipIf",
  "runIf",
]);
// Table-driven forms: one test per case, read from the table.
const TABLE_FORMS = new Set(["each", "for"]);
// Wrappers that leave the value they hold unchanged, so a table or handler behind
// one is read as the value itself.
const VALUE_WRAPPERS = new Set([
  "TsAsExpression",
  "TsConstAssertion",
  "TsSatisfiesExpression",
  "ParenthesisExpression",
]);
// A hook's callback runs when a test runs, after the file's focus is decided.
const HOOKS = new Set(["beforeAll", "afterAll", "beforeEach", "afterEach"]);
// A declaration with one of these modifiers never runs, so it cannot be
// evidence that a row is covered. Its descendants are excluded too.
const NEVER_RUNS = new Set(["skip", "todo"]);
// These run or skip by their condition. A literal condition is read; any other
// condition may skip, so the declaration is treated as not running.
const CONDITIONAL = new Set(["skipIf", "runIf"]);
// Statements that repeat, so a break or continue inside one stays in the loop.
const LOOPS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "SwitchStatement",
]);
// A return inside a nested function or method leaves that function, not the scope.
const FUNCTION_NODES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
  "ClassMethod",
  "PrivateMethod",
  "MethodProperty",
  "Constructor",
  "GetterProperty",
  "SetterProperty",
]);

type AstNode = Record<string, unknown>;

type Registration = {
  base: string;
  title: string | undefined;
  skipped: boolean;
  focused: boolean;
};

type Scope = { skipped: boolean; focused: boolean };

// A Vitest function a name stands for, and the modifiers after it.
type VitestName = { name: string; modifiers: string[] };

// How this file reaches Vitest: by its named imports and by its namespace.
type ImportContext = {
  // Local names bound to a Vitest export, to the export's name.
  functions: Map<string, string>;
  // Local names bound to the whole vitest module.
  namespaces: Set<string>;
  // Local names of imports from anything other than vitest. They bind the
  // module scope, so they shadow a Vitest global of the same name.
  shadowed: Set<string>;
};

// What one scope binds: null for a plain binding, which shadows a Vitest global
// of the same name, or the Vitest function a const stands for.
type Bindings = Map<string, VitestName | null>;

// What a call sees where it is written: the file's imports, and what each scope
// around the call binds, outermost (the module) first.
type Context = {
  imports: ImportContext;
  bindings: Bindings[];
};

/**
 * Row ids cited from the title argument of test calls that can run, in one
 * source file. Reading the parsed title, not the raw text, keeps citations in
 * assertion messages, comments, helpers and test bodies from counting.
 * A file that does not parse throws, so a broken test file cannot drop its
 * citations silently.
 */
export function titleCitations(source: string, fileName: string): string[] {
  const ast = parseSync(source, {
    syntax: "typescript",
    // Vitest parses every *.jsx, *.tsx, *.mtsx... test file as JSX.
    tsx: /[jt]sx$/.test(fileName),
  });
  const imports = readVitestImports(ast.body);
  const moduleNames: Bindings = new Map();
  for (const name of imports.shadowed) moduleNames.set(name, null);
  const context: Context = { imports, bindings: [moduleNames] };
  statementNames(ast.body, moduleNames, context);
  varNames(ast.body, moduleNames, context);
  const registrations: Registration[] = [];
  collectRegistrations(
    ast.body,
    { skipped: false, focused: false },
    registrations,
    context,
  );
  // Vitest runs only the focused tests of a file that has a focused one, and it
  // reads that focus from the calls that execute during collection. A focus the
  // scanner cannot rule out as unexecuted counts for the whole file.
  const fileFocused = containsFocus(ast.body, context);
  const ids: string[] = [];
  for (const registration of registrations) {
    const runs =
      !registration.skipped && (!fileFocused || registration.focused);
    // A suite title is not a test, so only it() and test() titles cite rows.
    if (!runs || registration.base === "describe") continue;
    if (registration.title === undefined) continue;
    for (const match of registration.title.matchAll(CITATION_PATTERN)) {
      ids.push(match[1]);
    }
  }
  return ids;
}

/** The names this file binds to Vitest, through its import declarations. */
function readVitestImports(statements: unknown): ImportContext {
  const imports: ImportContext = {
    functions: new Map(),
    namespaces: new Set(),
    shadowed: new Set(),
  };
  if (!Array.isArray(statements)) return imports;
  for (const statement of statements as AstNode[]) {
    if (statement.type !== "ImportDeclaration") continue;
    const fromVitest = (statement.source as AstNode).value === "vitest";
    const specifiers = Array.isArray(statement.specifiers)
      ? (statement.specifiers as AstNode[])
      : [];
    for (const specifier of specifiers) {
      const local = (specifier.local as AstNode).value;
      if (typeof local !== "string") continue;
      if (!fromVitest) {
        imports.shadowed.add(local);
        continue;
      }
      if (specifier.type === "ImportNamespaceSpecifier") {
        imports.namespaces.add(local);
      } else if (specifier.type === "ImportSpecifier") {
        const imported = specifier.imported as AstNode | null;
        imports.functions.set(
          local,
          typeof imported?.value === "string" ? imported.value : local,
        );
      }
    }
  }
  return imports;
}

/**
 * The Vitest function an initializer stands for: a name or member chain that
 * resolves to one, such as `it` or `it.only`, or `<test>.extend(...)`, which
 * returns a test function too.
 */
function aliasOf(init: unknown, context: Context): VitestName | undefined {
  const value = unwrapValue(init);
  if (value === undefined) return undefined;
  if (value.type === "CallExpression") {
    // `extend` builds a fresh test function, so the focus or skip of the chain it
    // extends does not carry over to it.
    const callee = memberChain(value.callee);
    if (callee === undefined || callee[callee.length - 1] !== "extend") {
      return undefined;
    }
    const base = resolveFunction(callee.slice(0, -1), context);
    return base !== undefined && TEST_FUNCTIONS.has(base.name)
      ? { name: base.name, modifiers: [] }
      : undefined;
  }
  const chain = memberChain(value);
  if (chain === undefined || chain.length === 0) return undefined;
  const resolved = resolveFunction(chain, context);
  return resolved !== undefined && TEST_FUNCTIONS.has(resolved.name)
    ? resolved
    : undefined;
}

/** The expression under any parentheses or type casts, which keep its value. */
function unwrapValue(value: unknown): AstNode | undefined {
  let node = value as AstNode | undefined;
  while (node !== undefined && VALUE_WRAPPERS.has(String(node.type))) {
    node = node.expression as AstNode | undefined;
  }
  return node;
}

/**
 * The names a node declares in the scope it opens, or undefined when it opens
 * none: a function's parameters and body bindings, a block's let, const, class
 * and function declarations, a loop head's let or const, a catch parameter, and
 * a switch's cases. A var is not here; it belongs to the nearest function.
 */
function scopeNames(node: AstNode, context: Context): Bindings | undefined {
  const names: Bindings = new Map();
  const inner: Context = {
    imports: context.imports,
    bindings: [...context.bindings, names],
  };
  if (isFunctionNode(node)) {
    for (const param of paramsOf(node)) addPlainNames(param, names);
    if (node.type === "FunctionExpression" && node.identifier !== undefined) {
      addPlainNames(node.identifier, names);
    }
    const body = node.body as AstNode | undefined;
    if (body?.type === "BlockStatement") {
      statementNames(body.stmts, names, inner);
    }
    varNames(node.body, names, inner);
    return names;
  }
  if (node.type === "BlockStatement") {
    statementNames(node.stmts, names, inner);
    return names;
  }
  if (
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement"
  ) {
    const head = (node.type === "ForStatement" ? node.init : node.left) as
      | AstNode
      | undefined;
    if (head?.type === "VariableDeclaration") {
      addLexicalNames(head, names, inner);
    }
    return names;
  }
  if (node.type === "CatchClause") {
    addPlainNames(node.param, names);
    return names;
  }
  if (node.type === "SwitchStatement") {
    for (const switchCase of node.cases as AstNode[]) {
      statementNames(switchCase.consequent, names, inner);
    }
    return names;
  }
  return undefined;
}

/**
 * Whether a node is a function. swc gives a class method's function as an
 * untyped node that holds its params and body.
 */
function isFunctionNode(node: AstNode): boolean {
  if (typeof node.type !== "string") return Array.isArray(node.params);
  return FUNCTION_NODES.has(node.type);
}

/** A function's parameters. A setter holds its single parameter as `param`. */
function paramsOf(node: AstNode): unknown[] {
  if (Array.isArray(node.params)) return node.params;
  return node.param === undefined ? [] : [node.param];
}

/** The context inside a node: what it binds joins what is around it. */
function enterScope(node: AstNode, context: Context): Context {
  const names = scopeNames(node, context);
  if (names === undefined) return context;
  return { imports: context.imports, bindings: [...context.bindings, names] };
}

/**
 * What a statement list binds. Its let, const, class and function declarations
 * are visible throughout the list, so they count from its start. An alias may
 * be made from an earlier alias, so the list is read in order.
 */
function statementNames(
  statements: unknown,
  out: Bindings,
  context: Context,
): void {
  if (!Array.isArray(statements)) return;
  const nodes = (statements as AstNode[]).map((statement) =>
    statement.type === "ExportDeclaration"
      ? (statement.declaration as AstNode)
      : statement,
  );
  // Every name the list declares is bound before any alias is read. A function
  // or class is hoisted, and a const may name one declared after it.
  for (const node of nodes) {
    if (node.type === "VariableDeclaration" && node.kind !== "var") {
      for (const declarator of node.declarations as AstNode[]) {
        addPlainNames(declarator.id, out);
      }
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "ClassDeclaration"
    ) {
      addPlainNames(node.identifier, out);
    }
  }
  // Then each const is read in order, so an alias may be made from an earlier one.
  for (const node of nodes) {
    if (node.type === "VariableDeclaration") {
      addLexicalNames(node, out, context);
    }
  }
}

/** The names a let or const declaration binds. A var is hoisted elsewhere. */
function addLexicalNames(
  declaration: AstNode,
  out: Bindings,
  context: Context,
): void {
  if (declaration.kind === "var") return;
  for (const declarator of declaration.declarations as AstNode[]) {
    addDeclarator(declarator, declaration.kind as string, out, context);
  }
}

/**
 * Records what a declarator binds. A const whose initializer stands for a Vitest
 * function is an alias of it. A let or var may be reassigned, so the scan cannot
 * follow it, and one that holds a Vitest function fails rather than being read
 * as a plain name.
 */
function addDeclarator(
  declarator: AstNode,
  kind: string,
  out: Bindings,
  context: Context,
): void {
  const id = declarator.id as AstNode;
  const alias = declarator.init ? aliasOf(declarator.init, context) : undefined;
  if (
    alias !== undefined &&
    id.type === "Identifier" &&
    typeof id.value === "string"
  ) {
    if (kind !== "const") {
      throw new Error(
        `"${id.value}" binds a Vitest function with ${kind}; bind it with const so the citation scan can follow it`,
      );
    }
    out.set(id.value, alias);
    return;
  }
  addPlainNames(id, out);
}

/**
 * What a node declares with var, anywhere outside a nested function. A var
 * hoists to its function, so one inside a nested block still binds the whole
 * function body.
 */
function varNames(value: unknown, out: Bindings, context: Context): void {
  if (Array.isArray(value)) {
    for (const item of value) varNames(item, out, context);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as AstNode;
  if (isFunctionNode(node)) return;
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const declarator of node.declarations as AstNode[]) {
      addDeclarator(declarator, "var", out, context);
    }
  }
  for (const child of Object.values(node)) varNames(child, out, context);
}

/** Records each name a binding pattern declares as a plain binding. */
function addPlainNames(pattern: unknown, out: Bindings): void {
  const names = new Set<string>();
  addPatternNames(pattern, names);
  for (const name of names) out.set(name, null);
}

/** The names a binding pattern declares. */
function addPatternNames(pattern: unknown, out: Set<string>): void {
  if (typeof pattern !== "object" || pattern === null) return;
  const node = pattern as AstNode;
  if (node.type === "Identifier" && typeof node.value === "string") {
    out.add(node.value);
  } else if (node.type === "Parameter") {
    addPatternNames(node.pat, out);
  } else if (node.type === "AssignmentPattern") {
    addPatternNames(node.left, out);
  } else if (node.type === "RestElement") {
    addPatternNames(node.argument, out);
  } else if (node.type === "ArrayPattern" && Array.isArray(node.elements)) {
    for (const element of node.elements) addPatternNames(element, out);
  } else if (node.type === "AssignmentPatternProperty") {
    // A shorthand { it } or defaulted { it = 1 } binds its key.
    addPatternNames(node.key, out);
  } else if (node.type === "ObjectPattern" && Array.isArray(node.properties)) {
    for (const property of node.properties as AstNode[]) {
      if (property.type === "KeyValuePatternProperty") {
        addPatternNames(property.value, out);
      } else {
        addPatternNames(property, out);
      }
    }
  }
}

/**
 * The tests Vitest registers. Only a plain expression statement at the top of
 * the file, or at the top of a suite callback, runs unconditionally, so only
 * those are read. Statements that may not run (if, loops, switch, try) and
 * functions that are merely defined or called later are not entered. Reading
 * stops at a statement that may leave the scope early, because the statements
 * after it are not guaranteed to run. Their tests stay uncited until a visible
 * test names the row, which fails closed.
 */
function collectRegistrations(
  statements: unknown,
  scope: Scope,
  out: Registration[],
  context: Context,
): void {
  if (!Array.isArray(statements)) return;
  for (const statement of statements as AstNode[]) {
    if (statement.type === "ExpressionStatement") {
      collectExpression(statement.expression, scope, out, context);
    }
    if (mayTransferControl(statement, false)) return;
  }
}

/**
 * Whether a statement can return, throw, or jump out of the scope. A break or
 * continue leaves the scope only when no loop or switch inside the statement
 * owns it; a labeled jump may leave any loop, so it always counts.
 */
function mayTransferControl(value: unknown, inLoop: boolean): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => mayTransferControl(item, inLoop));
  }
  if (typeof value !== "object" || value === null) return false;
  const node = value as AstNode;
  if (typeof node.type === "string") {
    if (node.type === "ReturnStatement" || node.type === "ThrowStatement") {
      return true;
    }
    if (node.type === "BreakStatement" || node.type === "ContinueStatement") {
      if (node.label) return true;
      return !inLoop;
    }
    if (FUNCTION_NODES.has(node.type)) return false;
  }
  const nested =
    inLoop || (typeof node.type === "string" && LOOPS.has(node.type));
  return Object.values(node).some((child) => mayTransferControl(child, nested));
}

function collectExpression(
  value: unknown,
  scope: Scope,
  out: Registration[],
  context: Context,
): void {
  const node = unchained(value);
  if (node.type !== "CallExpression") return;
  const declaration = declarationOf(node, context);
  if (declaration === undefined) return;
  // A table-driven declaration registers one test per case. A table that is not
  // a non-empty array literal cannot be shown to register any, so it is not
  // evidence that a row is covered.
  const callee = unchained(node.callee);
  if (
    declaration.modifiers.some((m) => TABLE_FORMS.has(m)) &&
    !tableHasCases(callee)
  ) {
    return;
  }
  const skipped = scope.skipped || isSkipped(declaration, callee);
  const hasOnly = declaration.modifiers.includes("only");
  const focused = scope.focused || hasOnly;
  out.push({
    base: declaration.base,
    title: titleText(firstArgument(node)),
    skipped,
    focused,
  });
  // Only a suite's callback registers tests. A test body does not, so a test
  // declared inside another test is never run and is not read.
  if (declaration.base !== "describe") return;
  for (const argument of argumentsOf(node)) {
    const callback = argument.expression as AstNode | undefined;
    // A suite that holds its own focus runs only that focus: its ordinary
    // children are skipped by Vitest, so they inherit no focus here.
    const holdsFocus =
      callback !== undefined && containsFocus(callback, context);
    collectCallback(
      callback,
      { skipped, focused: holdsFocus ? false : focused },
      out,
      context,
    );
  }
}

function collectCallback(
  node: AstNode | undefined,
  scope: Scope,
  out: Registration[],
  context: Context,
): void {
  if (node === undefined) return;
  if (
    node.type !== "ArrowFunctionExpression" &&
    node.type !== "FunctionExpression"
  ) {
    return;
  }
  // The callback's parameters and declarations shadow the names around it.
  const inner = enterScope(node, context);
  const body = node.body as AstNode;
  if (body.type === "BlockStatement") {
    collectRegistrations(body.stmts, scope, out, inner);
  } else {
    collectExpression(body, scope, out, inner);
  }
}

/**
 * True when a table-driven declaration's table can register a case: a non-empty
 * array literal, read through `as const`, or a tagged template with at least
 * one substitution. The table is the argument of the callee call for
 * it.each([...])("title", fn), and the template for it.each`...`("title", fn).
 */
function tableHasCases(callee: AstNode): boolean {
  if (callee.type === "TaggedTemplateExpression") {
    const template = callee.template as AstNode;
    return (
      Array.isArray(template.expressions) && template.expressions.length > 0
    );
  }
  // A direct call such as it.each("title", fn) has no table to read cases from.
  if (callee.type !== "CallExpression") return false;
  let table = argumentsOf(callee)[0]?.expression as AstNode | undefined;
  // `as const` and similar wrappers do not change the cases in the table.
  while (table !== undefined && VALUE_WRAPPERS.has(String(table.type))) {
    table = table.expression as AstNode | undefined;
  }
  // A spread may expand to no cases at all, so only plain entries are counted.
  return (
    table?.type === "ArrayExpression" &&
    Array.isArray(table.elements) &&
    table.elements.length > 0 &&
    table.elements.every(
      (element) => element !== null && !(element as AstNode).spread,
    )
  );
}

/**
 * Whether a focused declaration can register in the file. A branch behind a
 * literal condition is read only when that condition lets it run. Any other
 * branch is assumed to run, so a focus the scanner cannot place still counts.
 */
function containsFocus(value: unknown, context: Context): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsFocus(item, context));
  }
  if (typeof value !== "object" || value === null) return false;
  const node = value as AstNode;
  if (node.type === "IfStatement") {
    const test = node.test as AstNode;
    if (test.type === "BooleanLiteral") {
      return containsFocus(
        test.value ? node.consequent : node.alternate,
        context,
      );
    }
  }
  if (node.type === "CallExpression") {
    const declaration = declarationOf(node, context);
    // A focus over an empty table registers nothing, so it focuses nothing. The
    // table is the argument of this call, or of the table call it is made on.
    const emptyTable =
      declaration !== undefined &&
      declaration.modifiers.some((m) => TABLE_FORMS.has(m)) &&
      (hasEmptyTableArg(node) || hasEmptyTableArg(node.callee));
    if (declaration?.modifiers.includes("only") && !emptyTable) return true;
    // A handler runs after Vitest has decided the file's focus, so a focus inside
    // one changes nothing. The title, table and condition are evaluated while the
    // file is collected, so they are read.
    const deferred =
      (declaration !== undefined && declaration.base !== "describe") ||
      isHook(node.callee, context);
    if (deferred) {
      const parts = [
        node.callee,
        ...argumentsOf(node).map((argument) => argument.expression),
      ];
      return parts.some(
        (part) => !isHandler(part) && containsFocus(part, context),
      );
    }
  }
  const inner = enterScope(node, context);
  return Object.values(node).some((child) => containsFocus(child, inner));
}

/** Whether a call is one of Vitest's hooks, by the name it resolves to. */
function isHook(callee: unknown, context: Context): boolean {
  const chain = memberChain(callee);
  if (chain === undefined || chain.length === 0) return false;
  const resolved = resolveFunction(chain, context);
  return (
    resolved !== undefined &&
    HOOKS.has(resolved.name) &&
    resolved.modifiers.length === 0
  );
}

/**
 * The declaration a call makes, with the modes its options object sets and a
 * todo for a test that has no handler. Vitest reads an options object as the
 * test's mode, so `{ skip: true }` skips it the way `it.skip` would.
 */
function declarationOf(
  node: AstNode,
  context: Context,
): { base: string; modifiers: string[] } | undefined {
  const declaration = testDeclaration(node.callee, context);
  if (declaration === undefined) return undefined;
  const modifiers = [...declaration.modifiers, ...optionModes(node)];
  // A table form takes its handler in the next call, so only a plain test is
  // todo for lacking one.
  const tableForm = declaration.modifiers.some((m) => TABLE_FORMS.has(m));
  if (
    declaration.base !== "describe" &&
    !tableForm &&
    argumentsOf(node).length === 1
  ) {
    modifiers.push("todo");
  }
  return { base: declaration.base, modifiers };
}

/**
 * The modes an options object sets: skip, only and todo. A value that is not
 * literally false counts, since the scan cannot tell what it will be.
 */
function optionModes(node: AstNode): string[] {
  const modes: string[] = [];
  for (const argument of argumentsOf(node)) {
    const options = unwrapValue(argument.expression);
    if (options?.type !== "ObjectExpression") continue;
    for (const property of (options.properties ?? []) as AstNode[]) {
      if (property.type !== "KeyValueProperty") continue;
      const key = property.key as AstNode;
      const name = key.value;
      if (typeof name !== "string" || !OPTION_MODES.has(name)) continue;
      const value = unwrapValue(property.value);
      if (value?.type === "BooleanLiteral" && value.value === false) continue;
      modes.push(name);
    }
  }
  return modes;
}

/**
 * Whether a call's first argument is an empty array literal, the table of a
 * table-driven declaration. Vitest registers no test from an empty table.
 */
function hasEmptyTableArg(value: unknown): boolean {
  const call = unchained(value);
  if (call.type !== "CallExpression") return false;
  const table = unwrapValue(argumentsOf(call)[0]?.expression);
  return (
    table?.type === "ArrayExpression" &&
    Array.isArray(table.elements) &&
    table.elements.length === 0
  );
}

/** A function literal passed as a test's handler, which runs after collection. */
function isHandler(value: unknown): boolean {
  let node = value as AstNode | undefined;
  while (node !== undefined && VALUE_WRAPPERS.has(String(node.type))) {
    node = node.expression as AstNode | undefined;
  }
  return (
    node?.type === "ArrowFunctionExpression" ||
    node?.type === "FunctionExpression"
  );
}

/**
 * Whether a declaration never runs. skip and todo never run. skipIf and runIf
 * run by their condition, which is read only when it is a boolean literal.
 */
function isSkipped(
  declaration: { modifiers: string[] },
  callee: AstNode,
): boolean {
  if (declaration.modifiers.some((m) => NEVER_RUNS.has(m))) return true;
  const conditional = declaration.modifiers.find((m) => CONDITIONAL.has(m));
  if (conditional === undefined) return false;
  const condition =
    callee.type === "CallExpression"
      ? unwrapValue(argumentsOf(callee)[0]?.expression)
      : undefined;
  if (condition?.type !== "BooleanLiteral") return true;
  return conditional === "skipIf"
    ? condition.value === true
    : condition.value === false;
}

function argumentsOf(call: AstNode): AstNode[] {
  const args = call.arguments;
  if (!Array.isArray(args)) return [];
  return args as AstNode[];
}

function firstArgument(call: AstNode): AstNode | undefined {
  const first = argumentsOf(call)[0];
  return first?.expression as AstNode | undefined;
}

function titleText(node: AstNode | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "TemplateLiteral" && Array.isArray(node.expressions)) {
    // Only a template with no substitutions is a static title.
    if (node.expressions.length !== 0) return undefined;
    const quasi = (node.quasis as AstNode[])[0];
    return typeof quasi?.cooked === "string" ? quasi.cooked : undefined;
  }
  return undefined;
}

/**
 * The declaration a call makes: it("..."), it.only("..."), it.skip.each([...])("..."),
 * it.each`...`("..."), and any of these through an aliased or namespace import
 * of vitest. Returns undefined for any other call.
 */
function testDeclaration(
  callee: unknown,
  context: Context,
): { base: string; modifiers: string[] } | undefined {
  const node = unchained(callee);
  // The outer call's callee is the table call or the tagged template.
  let chainNode: AstNode = node;
  if (node.type === "CallExpression") chainNode = node.callee as AstNode;
  if (node.type === "TaggedTemplateExpression") chainNode = node.tag as AstNode;
  const chain = memberChain(chainNode);
  if (chain === undefined || chain.length === 0) return undefined;
  const resolved = resolveFunction(chain, context);
  if (resolved === undefined || !TEST_FUNCTIONS.has(resolved.name)) {
    return undefined;
  }
  const { modifiers } = resolved;
  if (modifiers.some((m) => !TEST_MODIFIERS.has(m))) return undefined;
  const isCallForm =
    node.type === "CallExpression" || node.type === "TaggedTemplateExpression";
  if (
    isCallForm &&
    !modifiers.some((m) => TABLE_FORMS.has(m) || CONDITIONAL.has(m))
  ) {
    return undefined;
  }
  return {
    base: resolved.name === "suite" ? "describe" : resolved.name,
    modifiers,
  };
}

/**
 * The Vitest function a member chain names, and the modifiers after it. A
 * name that an enclosing scope declares is not Vitest at this call. Otherwise a
 * namespace import names the member after the namespace; a named import may be
 * renamed; and anything else is the Vitest global of that name.
 */
function resolveFunction(
  chain: string[],
  context: Context,
): VitestName | undefined {
  const [head, ...rest] = chain;
  // The innermost scope that binds the head decides what it is. A plain binding
  // shadows the Vitest global; an alias stands for the function it was bound to.
  // A binding elsewhere in the file, such as a helper's parameter, does not
  // reach this call.
  for (let index = context.bindings.length - 1; index >= 0; index--) {
    const bound = context.bindings[index].get(head);
    if (bound !== undefined) {
      return bound === null
        ? undefined
        : { name: bound.name, modifiers: [...bound.modifiers, ...rest] };
    }
  }
  const { imports } = context;
  if (imports.namespaces.has(head)) {
    const [member, ...modifiers] = rest;
    return member === undefined ? undefined : { name: member, modifiers };
  }
  const imported = imports.functions.get(head);
  if (imported !== undefined) return { name: imported, modifiers: rest };
  return { name: head, modifiers: rest };
}

/** The dotted names of an identifier or plain member chain, e.g. it.skip.each. */
/**
 * The expression an optional chain wraps. swc parses `it?.only(...)` and
 * `it?.each(table)(...)` as chains over their calls, so they are read through.
 */
function unchained(value: unknown): AstNode {
  const node = value as AstNode;
  return node.type === "OptionalChainingExpression"
    ? (node.base as AstNode)
    : node;
}

function memberChain(node: unknown): string[] | undefined {
  const value = node as AstNode | undefined;
  if (value === undefined) return undefined;
  if (value.type === "Identifier" && typeof value.value === "string") {
    return [value.value];
  }
  if (value.type === "OptionalChainingExpression") {
    return memberChain(value.base);
  }
  if (
    VALUE_WRAPPERS.has(String(value.type)) ||
    value.type === "TsNonNullExpression"
  ) {
    return memberChain(value.expression);
  }
  if (value.type === "MemberExpression") {
    const object = memberChain(value.object);
    const name = memberName(value);
    if (object === undefined || name === undefined) return undefined;
    return [...object, name];
  }
  return undefined;
}

/**
 * The name a member expression reads: `.only`, or the string in `["only"]`.
 * swc wraps a computed key in a Computed node and records no computed flag on
 * the member, so the wrapper is what marks it.
 */
function memberName(member: AstNode): string | undefined {
  const property = member.property as AstNode | undefined;
  if (property?.type === "Computed") {
    const key = unwrapValue(property.expression);
    if (key?.type === "StringLiteral" && typeof key.value === "string") {
      return key.value;
    }
    // A template with no substitutions is a static name, as in it[`only`].
    if (key?.type === "TemplateLiteral" && Array.isArray(key.expressions)) {
      const quasi = (key.quasis as AstNode[])[0];
      return key.expressions.length === 0 && typeof quasi?.cooked === "string"
        ? quasi.cooked
        : undefined;
    }
    return undefined;
  }
  return property?.type === "Identifier" && typeof property.value === "string"
    ? property.value
    : undefined;
}
