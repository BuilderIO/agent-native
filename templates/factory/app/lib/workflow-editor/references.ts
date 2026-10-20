import {
  ExpressionError,
  nodeScopeKey,
  parseTemplate,
  validatePath,
  type ExpressionErrorCode,
  type FieldBinding,
  type ParsedPath,
  type Rule,
  type WorkflowGraph,
  type WorkflowNode,
} from "./engine.js";
import type { NodeReference } from "./types.js";

interface ExpressionSite {
  where: string;
  /** A bare path, or text that may hold `{{ path }}` holes. */
  kind: "path" | "template";
  text: string;
}

function stringsIn(value: unknown): string[] {
  const strings: string[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === "string") strings.push(next);
    else if (Array.isArray(next)) stack.push(...next);
    else if (typeof next === "object" && next !== null) {
      stack.push(...Object.values(next));
    }
  }
  return strings;
}

function bindingSites(
  args: Record<string, FieldBinding>,
  where: string,
): ExpressionSite[] {
  return Object.entries(args).flatMap(([name, binding]): ExpressionSite[] => {
    const here = `${where}.${name}`;
    if (binding.mode === "path") {
      return [{ where: here, kind: "path", text: binding.path }];
    }
    if (binding.mode === "fixed") {
      return stringsIn(binding.value).map((text) => ({
        where: here,
        kind: "template",
        text,
      }));
    }
    return [];
  });
}

function ruleSites(rules: readonly Rule[], where: string): ExpressionSite[] {
  return rules.flatMap((rule): ExpressionSite[] => [
    { where, kind: "path", text: rule.left },
    ...stringsIn(rule.right).map(
      (text): ExpressionSite => ({ where, kind: "template", text }),
    ),
  ]);
}

/**
 * Every place a node reads a path. This mirrors the table the graph
 * validator walks for `bad_reference`; a spec keeps the two in step.
 */
function expressionSites(node: WorkflowNode): ExpressionSite[] {
  switch (node.kind) {
    case "source":
      return node.settings.source === "provider-query" ||
        node.settings.source === "window"
        ? bindingSites(node.settings.args, "args")
        : [];
    case "lookup":
    case "action":
    case "agent":
      return bindingSites(node.settings.args, "args");
    case "filter":
      return ruleSites(node.settings.rules, "rules");
    case "switch":
      return node.settings.routes.flatMap((route) =>
        ruleSites(route.rules, `route ${route.id}`),
      );
    case "combine": {
      const { key, field, summarize } = node.settings;
      const paths: [string, string | undefined][] = [
        ["key", key],
        ["field", field],
        ["summarize.group", summarize?.group],
        ["summarize.value", summarize?.value],
      ];
      return paths.flatMap(([where, text]): ExpressionSite[] =>
        text === undefined ? [] : [{ where, kind: "path", text }],
      );
    }
    case "split":
      return [{ where: "field", kind: "path", text: node.settings.field }];
    case "wait":
      return node.settings.wait === "condition"
        ? [
            ...bindingSites(node.settings.args, "args"),
            ...ruleSites([node.settings.rule], "rule"),
          ]
        : [];
    case "end":
      return [
        ...(node.settings.reason === undefined
          ? []
          : [
              {
                where: "reason",
                kind: "template",
                text: node.settings.reason,
              } satisfies ExpressionSite,
            ]),
        ...bindingSites(node.settings.record ?? {}, "record"),
      ];
    default:
      return [];
  }
}

/** The node names a site reads, as `nodes.<name>` references. Text that does not parse reads none. */
function referencedNames(site: ExpressionSite): string[] {
  if (site.kind === "path") {
    const check = validatePath(site.text);
    if (!check.ok || check.path.root !== "nodes") return [];
    const [name] = check.path.segments;
    return typeof name === "string" ? [name] : [];
  }
  try {
    return parseTemplate(site.text).parts.flatMap((part) =>
      part.type === "hole" && part.root === "nodes"
        ? typeof part.segments[0] === "string"
          ? [part.segments[0]]
          : []
        : [],
    );
  } catch (error) {
    if (error instanceof ExpressionError) {
      // coercion-ok: text that does not parse reads no node; the validator reports it as its own issue
      return [];
    }
    throw error;
  }
}

/**
 * The places that read `nodes.<name>` for this node. Renaming a node leaves
 * these pointing at the old name, so the caller shows them instead of the
 * editor rewriting expressions.
 */
export function findNodeReferences(
  graph: WorkflowGraph,
  nodeId: string,
  scopeKey?: string,
): NodeReference[] {
  const target = graph.nodes.find((node) => node.id === nodeId);
  if (!target) return [];
  const key = scopeKey ?? nodeScopeKey(target);
  const references: NodeReference[] = [];
  for (const node of graph.nodes) {
    for (const site of expressionSites(node)) {
      if (referencedNames(site).includes(key)) {
        references.push({ nodeId: node.id, where: site.where });
      }
    }
  }
  return references;
}

export interface ExpressionContext {
  /** Every name a path can read as `nodes.<name>`. */
  scopeKeys: ReadonlySet<string>;
  /** The names reachable backwards over forward edges, which a node may read. */
  upstreamKeys: ReadonlySet<string>;
}

/** What a node can read, worked out the way the graph validator does. */
export function expressionContext(
  graph: WorkflowGraph,
  nodeId: string,
): ExpressionContext {
  const upstream = new Set<string>();
  const queue = [nodeId];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const edge of graph.edges) {
      if (edge.back || edge.to.node !== next || upstream.has(edge.from.node)) {
        continue;
      }
      upstream.add(edge.from.node);
      queue.push(edge.from.node);
    }
  }
  upstream.delete(nodeId);
  return {
    scopeKeys: new Set(graph.nodes.map(nodeScopeKey)),
    upstreamKeys: new Set(
      graph.nodes.filter((n) => upstream.has(n.id)).map(nodeScopeKey),
    ),
  };
}

export type ExpressionProblem =
  | { code: ExpressionErrorCode; position: number }
  | { code: "unknown_node"; name: string }
  | { code: "not_upstream"; name: string }
  | { code: "no_node_name" };

function checkParsed(
  path: ParsedPath,
  context: ExpressionContext | undefined,
): ExpressionProblem | null {
  if (path.root !== "nodes" || !context) return null;
  const [name] = path.segments;
  if (typeof name !== "string") return { code: "no_node_name" };
  if (!context.scopeKeys.has(name)) return { code: "unknown_node", name };
  if (!context.upstreamKeys.has(name)) return { code: "not_upstream", name };
  return null;
}

/** The first problem with a bare path, or null when it reads cleanly. */
export function checkPathText(
  text: string,
  context?: ExpressionContext,
): ExpressionProblem | null {
  const check = validatePath(text);
  if (!check.ok) {
    return { code: check.error.code, position: check.error.position };
  }
  return checkParsed(check.path, context);
}

/** The first problem with text that may hold `{{ path }}` holes, or null. */
export function checkTemplateText(
  text: string,
  context?: ExpressionContext,
): ExpressionProblem | null {
  try {
    for (const part of parseTemplate(text).parts) {
      if (part.type !== "hole") continue;
      const problem = checkParsed(part, context);
      if (problem) return problem;
    }
    return null;
  } catch (error) {
    if (error instanceof ExpressionError) {
      return { code: error.code, position: error.position };
    }
    throw error;
  }
}
