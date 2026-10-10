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
  // Vitest runs only the focused tests of a file that has a focused one.
  const fileFocused = hasFocusedDeclaration(ast);
  const ids: string[] = [];
  collectTitleCitations(
    ast,
    { skipped: false, focused: false },
    fileFocused,
    ids,
  );
  return ids;
}

type Scope = { skipped: boolean; focused: boolean };

function collectTitleCitations(
  value: unknown,
  scope: Scope,
  fileFocused: boolean,
  ids: string[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTitleCitations(item, scope, fileFocused, ids);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as AstNode;
  let inner = scope;
  if (node.type === "CallExpression") {
    const declaration = testDeclaration(node.callee);
    if (declaration !== undefined) {
      const skipped =
        scope.skipped || declaration.modifiers.some((m) => NOT_RUNNABLE.has(m));
      const focused = scope.focused || declaration.modifiers.includes("only");
      inner = { skipped, focused };
      const title = titleText(firstArgument(node));
      // A suite title is not a test, so only it() and test() titles cite rows.
      const runs = !skipped && (!fileFocused || focused);
      if (runs && declaration.base !== "describe" && title !== undefined) {
        for (const match of title.matchAll(CITATION_PATTERN)) {
          ids.push(match[1]);
        }
      }
    }
  }
  for (const child of Object.values(node)) {
    collectTitleCitations(child, inner, fileFocused, ids);
  }
}

function hasFocusedDeclaration(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFocusedDeclaration);
  if (typeof value !== "object" || value === null) return false;
  const node = value as AstNode;
  if (node.type === "CallExpression") {
    const declaration = testDeclaration(node.callee);
    if (declaration?.modifiers.includes("only")) return true;
  }
  return Object.values(node).some(hasFocusedDeclaration);
}

function firstArgument(call: AstNode): AstNode | undefined {
  const args = call.arguments;
  if (!Array.isArray(args) || args.length === 0) return undefined;
  const first = args[0] as AstNode;
  return first.expression as AstNode | undefined;
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
