import { parseSync } from "@swc/core";

// Letter families (T, H, V, P, E, O, F, K) must match as well as digits; a
// digit-only pattern would drop their citations without any failure.
const CITATION_PATTERN =
  /\boracle ((?:\d+|[A-Z])\.\d+[a-z]?|G\.[a-z0-9][a-z0-9.-]*)\b/g;

// The functions Vitest declares tests with, as globals or as named imports.
// suite is describe under another name.
const TEST_FUNCTIONS = new Set(["it", "test", "describe", "suite"]);
const TEST_MODIFIERS = new Set([
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
const TABLE_WRAPPERS = new Set([
  "TsAsExpression",
  "TsConstAssertion",
  "TsSatisfiesExpression",
  "ParenthesisExpression",
]);
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

// How this file reaches Vitest: by its named imports and by its namespace.
type ImportContext = {
  // Local names bound to a Vitest export, to the export's name.
  functions: Map<string, string>;
  // Local names bound to the whole vitest module.
  namespaces: Set<string>;
  // Names this file binds to something other than Vitest, which shadow a
  // Vitest global of the same name.
  shadowed: Set<string>;
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
  declaredNames(ast.body, imports.shadowed);
  const registrations: Registration[] = [];
  collectRegistrations(
    ast.body,
    { skipped: false, focused: false },
    registrations,
    imports,
  );
  // Vitest runs only the focused tests of a file that has a focused one. A
  // focused declaration in unreachable code still changes the file's run, so
  // the whole file counts as focused and only reachable focused tests cite.
  const fileFocused = containsFocus(ast.body, imports);
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
 * Every name the file declares itself: variables, functions, classes,
 * parameters and catch bindings. A declared name shadows a Vitest global of the
 * same name, so a call through it registers no Vitest test.
 */
function declaredNames(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) declaredNames(item, out);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as AstNode;
  if (node.type === "VariableDeclarator") addPatternNames(node.id, out);
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    addPatternNames(node.identifier, out);
  }
  if (node.type === "CatchClause") addPatternNames(node.param, out);
  if (Array.isArray(node.params)) {
    for (const param of node.params) addPatternNames(param, out);
  }
  for (const child of Object.values(node)) declaredNames(child, out);
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
  imports: ImportContext,
): void {
  if (!Array.isArray(statements)) return;
  for (const statement of statements as AstNode[]) {
    if (statement.type === "ExpressionStatement") {
      collectExpression(statement.expression, scope, out, imports);
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
  imports: ImportContext,
): void {
  const node = value as AstNode;
  if (node.type !== "CallExpression") return;
  const declaration = testDeclaration(node.callee, imports);
  if (declaration === undefined) return;
  // A table-driven declaration registers one test per case. A table that is not
  // a non-empty array literal cannot be shown to register any, so it is not
  // evidence that a row is covered.
  if (
    declaration.modifiers.some((m) => TABLE_FORMS.has(m)) &&
    !tableHasCases(node.callee as AstNode)
  ) {
    return;
  }
  const skipped =
    scope.skipped || isSkipped(declaration, node.callee as AstNode);
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
      callback !== undefined && containsFocus(callback, imports);
    collectCallback(
      callback,
      { skipped, focused: holdsFocus ? false : focused },
      out,
      imports,
    );
  }
}

function collectCallback(
  node: AstNode | undefined,
  scope: Scope,
  out: Registration[],
  imports: ImportContext,
): void {
  if (node === undefined) return;
  if (
    node.type !== "ArrowFunctionExpression" &&
    node.type !== "FunctionExpression"
  ) {
    return;
  }
  const body = node.body as AstNode;
  if (body.type === "BlockStatement") {
    collectRegistrations(body.stmts, scope, out, imports);
  } else {
    collectExpression(body, scope, out, imports);
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
  while (table !== undefined && TABLE_WRAPPERS.has(String(table.type))) {
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
function containsFocus(value: unknown, imports: ImportContext): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsFocus(item, imports));
  }
  if (typeof value !== "object" || value === null) return false;
  const node = value as AstNode;
  if (node.type === "IfStatement") {
    const test = node.test as AstNode;
    if (test.type === "BooleanLiteral") {
      return containsFocus(
        test.value ? node.consequent : node.alternate,
        imports,
      );
    }
  }
  if (node.type === "CallExpression") {
    const declaration = testDeclaration(node.callee, imports);
    if (declaration?.modifiers.includes("only")) return true;
  }
  return Object.values(node).some((child) => containsFocus(child, imports));
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
      ? (argumentsOf(callee)[0]?.expression as AstNode | undefined)
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
  imports: ImportContext,
): { base: string; modifiers: string[] } | undefined {
  const node = callee as AstNode;
  // The outer call's callee is the table call or the tagged template.
  let chainNode: AstNode = node;
  if (node.type === "CallExpression") chainNode = node.callee as AstNode;
  if (node.type === "TaggedTemplateExpression") chainNode = node.tag as AstNode;
  const chain = memberChain(chainNode);
  if (chain === undefined || chain.length === 0) return undefined;
  const resolved = resolveFunction(chain, imports);
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
 * namespace import names it as the member after the namespace; a named import
 * may be renamed; otherwise the chain names a global.
 */
function resolveFunction(
  chain: string[],
  imports: ImportContext,
): { name: string; modifiers: string[] } | undefined {
  const [head, ...rest] = chain;
  if (imports.namespaces.has(head)) {
    const [member, ...modifiers] = rest;
    return member === undefined ? undefined : { name: member, modifiers };
  }
  const imported = imports.functions.get(head);
  if (imported !== undefined) return { name: imported, modifiers: rest };
  // The name is Vitest's global only when nothing in this file shadows it.
  if (imports.shadowed.has(head)) return undefined;
  return { name: head, modifiers: rest };
}

/** The dotted names of an identifier or plain member chain, e.g. it.skip.each. */
function memberChain(node: unknown): string[] | undefined {
  const value = node as AstNode | undefined;
  if (value === undefined) return undefined;
  if (value.type === "Identifier" && typeof value.value === "string") {
    return [value.value];
  }
  if (value.type === "MemberExpression" && value.computed !== true) {
    const object = memberChain(value.object);
    const property = value.property as AstNode | undefined;
    if (
      object === undefined ||
      property?.type !== "Identifier" ||
      typeof property.value !== "string"
    ) {
      return undefined;
    }
    return [...object, property.value];
  }
  return undefined;
}
