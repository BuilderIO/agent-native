import { parseSync } from "@swc/core";

// Letter families (T, H, V, P, E, O, F, K) must match as well as digits; a
// digit-only pattern would drop their citations without any failure.
const CITATION_PATTERN =
  /\boracle ((?:\d+|[A-Z])\.\d+[a-z]?|G\.[a-z0-9][a-z0-9.-]*)\b/g;

const TEST_FUNCTIONS = new Set(["it", "test", "describe"]);
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
// Statements that leave the scope early. Code after one may not run.
const TRANSFERS_CONTROL = new Set([
  "ReturnStatement",
  "ThrowStatement",
  "BreakStatement",
  "ContinueStatement",
]);
// A return inside a nested function leaves that function, not the scope.
const FUNCTION_NODES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

type AstNode = Record<string, unknown>;

type Registration = {
  base: string;
  title: string | undefined;
  skipped: boolean;
  focused: boolean;
};

type Scope = { skipped: boolean; focused: boolean };

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
    // Vitest parses every *.jsx, *.tsx, *.mjsx, *.cts... test file as JSX.
    tsx: /[jt]sx$/.test(fileName),
  });
  const registrations: Registration[] = [];
  collectRegistrations(
    ast.body,
    { skipped: false, focused: false },
    registrations,
  );
  // Vitest runs only the focused tests of a file that has a focused one. A
  // focused declaration in unreachable code still changes the file's run, so
  // the whole file counts as focused and only reachable focused tests cite.
  const fileFocused = containsFocus(ast.body);
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
): void {
  if (!Array.isArray(statements)) return;
  for (const statement of statements as AstNode[]) {
    if (statement.type === "ExpressionStatement") {
      collectExpression(statement.expression, scope, out);
    }
    if (mayTransferControl(statement)) return;
  }
}

function mayTransferControl(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(mayTransferControl);
  if (typeof value !== "object" || value === null) return false;
  const node = value as AstNode;
  if (typeof node.type === "string") {
    if (TRANSFERS_CONTROL.has(node.type)) return true;
    if (FUNCTION_NODES.has(node.type)) return false;
  }
  return Object.values(node).some(mayTransferControl);
}

function collectExpression(
  value: unknown,
  scope: Scope,
  out: Registration[],
): void {
  const node = value as AstNode;
  if (node.type !== "CallExpression") return;
  const declaration = testDeclaration(node.callee);
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
    collectCallback(
      argument.expression as AstNode | undefined,
      { skipped, focused },
      out,
    );
  }
}

function collectCallback(
  node: AstNode | undefined,
  scope: Scope,
  out: Registration[],
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
    collectRegistrations(body.stmts, scope, out);
  } else {
    collectExpression(body, scope, out);
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
  if (callee.type !== "CallExpression") return true;
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
function containsFocus(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsFocus);
  if (typeof value !== "object" || value === null) return false;
  const node = value as AstNode;
  if (node.type === "IfStatement") {
    const test = node.test as AstNode;
    if (test.type === "BooleanLiteral") {
      return containsFocus(test.value ? node.consequent : node.alternate);
    }
  }
  if (node.type === "CallExpression") {
    const declaration = testDeclaration(node.callee);
    if (declaration?.modifiers.includes("only")) return true;
  }
  return Object.values(node).some(containsFocus);
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
 * and it.each`...`("..."). Returns undefined for any other call.
 */
function testDeclaration(
  callee: unknown,
): { base: string; modifiers: string[] } | undefined {
  const node = callee as AstNode;
  // The outer call's callee is the table call or the tagged template.
  let chainNode: AstNode = node;
  if (node.type === "CallExpression") chainNode = node.callee as AstNode;
  if (node.type === "TaggedTemplateExpression") chainNode = node.tag as AstNode;
  const chain = memberChain(chainNode);
  if (chain === undefined || chain.length === 0) return undefined;
  const [base, ...modifiers] = chain;
  if (!TEST_FUNCTIONS.has(base)) return undefined;
  if (modifiers.some((m) => !TEST_MODIFIERS.has(m))) return undefined;
  const isCallForm =
    node.type === "CallExpression" || node.type === "TaggedTemplateExpression";
  if (
    isCallForm &&
    !modifiers.some((m) => TABLE_FORMS.has(m) || CONDITIONAL.has(m))
  ) {
    return undefined;
  }
  return { base, modifiers };
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
