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
]);

type AstNode = Record<string, unknown>;

/**
 * Row ids cited from the title argument of test calls in one source file.
 * Reading the parsed title, not the raw text, keeps citations in assertion
 * messages, comments, helpers and test bodies from counting as coverage.
 * A file that does not parse throws, so a broken test file cannot drop its
 * citations silently.
 */
export function titleCitations(source: string, fileName: string): string[] {
  const ast = parseSync(source, {
    syntax: "typescript",
    tsx: fileName.endsWith(".tsx"),
  });
  const ids: string[] = [];
  forEachNode(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const title = titleText(firstArgument(node));
    if (title === undefined || !isTestCallee(node.callee)) return;
    for (const match of title.matchAll(CITATION_PATTERN)) {
      ids.push(match[1]);
    }
  });
  return ids;
}

function forEachNode(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) forEachNode(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as AstNode;
  if (typeof node.type === "string") visit(node);
  for (const child of Object.values(node)) forEachNode(child, visit);
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

function identifierName(node: unknown): string | undefined {
  const value = node as AstNode | undefined;
  return value?.type === "Identifier" && typeof value.value === "string"
    ? value.value
    : undefined;
}

function isTestCallee(callee: unknown): boolean {
  const node = callee as AstNode;
  const direct = identifierName(node);
  if (direct !== undefined) return TEST_FUNCTIONS.has(direct);
  if (node.type === "MemberExpression") {
    const object = identifierName(node.object);
    const property = identifierName(node.property);
    return (
      object !== undefined &&
      property !== undefined &&
      TEST_FUNCTIONS.has(object) &&
      TEST_MODIFIERS.has(property)
    );
  }
  // it.each([...])("title", fn): the outer call takes the title.
  if (node.type === "CallExpression") {
    const inner = node.callee as AstNode;
    if (inner.type !== "MemberExpression") return false;
    const object = identifierName(inner.object);
    return (
      object !== undefined &&
      TEST_FUNCTIONS.has(object) &&
      identifierName(inner.property) === "each"
    );
  }
  return false;
}
