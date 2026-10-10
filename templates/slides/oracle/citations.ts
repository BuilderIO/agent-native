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
  "concurrent",
  "fails",
  "sequential",
  "skipIf",
  "runIf",
]);
// A declaration with one of these modifiers may not run, so it cannot be
// evidence that a row is covered. Its descendants are excluded too.
const NOT_RUNNABLE = new Set(["skip", "todo", "skipIf", "runIf"]);

type AstNode = Record<string, unknown>;

type Registration = {
  base: string;
  title: string | undefined;
  hasOnly: boolean;
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
    tsx: fileName.endsWith(".tsx"),
  });
  const registrations: Registration[] = [];
  collectRegistrations(
    ast.body,
    { skipped: false, focused: false },
    registrations,
  );
  // Vitest runs only the focused tests of a file that has a focused one.
  const fileFocused = registrations.some((r) => r.hasOnly);
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
 * functions that are merely defined or called later are not entered. Their
 * tests stay uncited until a visible test names the row, which fails closed.
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
  }
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
  const skipped =
    scope.skipped || declaration.modifiers.some((m) => NOT_RUNNABLE.has(m));
  const hasOnly = declaration.modifiers.includes("only");
  const focused = scope.focused || hasOnly;
  out.push({
    base: declaration.base,
    title: titleText(firstArgument(node)),
    hasOnly,
    skipped,
    focused,
  });
  // A suite's callback runs its own statements, and only they are read.
  for (const argument of argumentsOf(node)) {
    collectCallback(
      argument.expression as AstNode | undefined,
      {
        skipped,
        focused,
      },
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
 * The declaration a call makes: it("..."), it.only("..."), it.skip.each([...])("...").
 * Returns undefined for any other call.
 */
function testDeclaration(
  callee: unknown,
): { base: string; modifiers: string[] } | undefined {
  const node = callee as AstNode;
  // it.skip.each([...])("title"): the outer call's callee is the table call.
  const chainNode = node.type === "CallExpression" ? node.callee : node;
  const chain = memberChain(chainNode);
  if (chain === undefined || chain.length === 0) return undefined;
  const [base, ...modifiers] = chain;
  if (!TEST_FUNCTIONS.has(base)) return undefined;
  if (modifiers.some((m) => !TEST_MODIFIERS.has(m))) return undefined;
  if (node.type === "CallExpression" && !modifiers.includes("each")) {
    if (!modifiers.some((m) => m === "skipIf" || m === "runIf")) {
      return undefined;
    }
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
