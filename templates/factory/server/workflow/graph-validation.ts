import {
  WorkflowError,
  nodeScopeKey,
  type FieldBinding,
  type Rule,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
} from "./contract.js";
import {
  ExpressionError,
  collectPaths,
  parsePath,
  parseTemplate,
  validatePath,
  type ParsedPath,
} from "./expressions.js";
import {
  isWriteAllowedForNode,
  type OperationCatalog,
  type OperationDefinition,
  type OperationNodeKind,
} from "./operations.js";
import { portsFor, portsWithLimit } from "./ports.js";

export const ISSUE_CODES = [
  "trigger_count",
  "duplicate_node_id",
  "duplicate_node_name",
  "duplicate_edge_id",
  "duplicate_switch_route",
  "edge_unknown_node",
  "edge_unknown_port",
  "edge_into_trigger",
  "port_leads_nowhere",
  "unreachable_node",
  "cycle_without_back_edge",
  "back_edge_without_cycle",
  "multiple_back_edges",
  "nested_loop",
  "loop_without_wait",
  "status_source_back_edge",
  "unknown_operation",
  "unknown_tool",
  "operation_kind_mismatch",
  "unknown_field",
  "missing_required_field",
  "enum_value_invalid",
  "field_type_mismatch",
  "bad_reference",
  "model_written_target",
] as const;
export type WorkflowIssueCode = (typeof ISSUE_CODES)[number];

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  nodeId?: string;
  edgeId?: string;
  port?: string;
  /** Plain-language specifics, such as the offending path. */
  detail?: string;
}

export interface WorkflowValidation {
  ok: boolean;
  issues: WorkflowIssue[];
}

type Adjacency = Map<string, string[]>;

function adjacency(edges: readonly WorkflowEdge[], reverse = false): Adjacency {
  const map: Adjacency = new Map();
  for (const edge of edges) {
    const [from, to] = reverse
      ? [edge.to.node, edge.from.node]
      : [edge.from.node, edge.to.node];
    map.set(from, [...(map.get(from) ?? []), to]);
  }
  return map;
}

/** Every node reachable from `start`, `start` included. */
function reachable(start: string, adj: Adjacency): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const target of adj.get(next) ?? []) {
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return seen;
}

/** Nodes at which a depth-first walk meets a node still on its own path. */
function cycleEntries(nodeIds: string[], adj: Adjacency): string[] {
  const state = new Map<string, "open" | "done">();
  const entries = new Set<string>();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const target of adj.get(id) ?? []) {
      const seen = state.get(target);
      if (seen === "open") entries.add(target);
      else if (seen === undefined) visit(target);
    }
    state.set(id, "done");
  };
  for (const id of nodeIds) if (!state.has(id)) visit(id);
  return [...entries];
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

interface Expression {
  where: string;
  kind: "path" | "template";
  text: string;
}

function bindingExpressions(
  args: Record<string, FieldBinding>,
  where: string,
): Expression[] {
  return Object.entries(args).flatMap(([name, binding]): Expression[] => {
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

function ruleExpressions(rules: readonly Rule[], where: string): Expression[] {
  return rules.flatMap((rule): Expression[] => [
    { where, kind: "path", text: rule.left },
    ...stringsIn(rule.right).map(
      (text): Expression => ({ where, kind: "template", text }),
    ),
  ]);
}

function expressionsOf(node: WorkflowNode): Expression[] {
  switch (node.kind) {
    case "source":
      return node.settings.source === "provider-query" ||
        node.settings.source === "window"
        ? bindingExpressions(node.settings.args, "args")
        : [];
    case "lookup":
    case "action":
    case "agent":
      return bindingExpressions(node.settings.args, "args");
    case "filter":
      return ruleExpressions(node.settings.rules, "rules");
    case "switch":
      return node.settings.routes.flatMap((route) =>
        ruleExpressions(route.rules, `route ${route.id}`),
      );
    case "combine": {
      const { key, field, summarize } = node.settings;
      const paths: [string, string | undefined][] = [
        ["key", key],
        ["field", field],
        ["summarize.group", summarize?.group],
        ["summarize.value", summarize?.value],
      ];
      return paths.flatMap(([where, text]): Expression[] =>
        text === undefined ? [] : [{ where, kind: "path", text }],
      );
    }
    case "split":
      return [{ where: "field", kind: "path", text: node.settings.field }];
    case "wait":
      return node.settings.wait === "condition"
        ? [
            ...bindingExpressions(node.settings.args, "args"),
            ...ruleExpressions([node.settings.rule], "rule"),
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
              } satisfies Expression,
            ]),
        ...bindingExpressions(node.settings.record ?? {}, "record"),
      ];
    default:
      return [];
  }
}

/**
 * Every path a node's settings read, parsed. A graph that passed validation
 * has none that fails to parse, so a failure here is `graph_invalid` and not a
 * path to skip.
 */
export function pathsReadBy(node: WorkflowNode): ParsedPath[] {
  return expressionsOf(node).flatMap((expression): ParsedPath[] => {
    try {
      return expression.kind === "path"
        ? [parsePath(expression.text)]
        : collectPaths(expression.text);
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      throw new WorkflowError(
        "graph_invalid",
        `"${node.name}" ${expression.where}: ${error.message}`,
      );
    }
  });
}

/** The operation a node runs and the node kind it runs as. */
interface OperationUse {
  id: string;
  as: OperationNodeKind;
  needsWindow: boolean;
}

export function operationUse(node: WorkflowNode): OperationUse | undefined {
  switch (node.kind) {
    case "source":
      return node.settings.source === "provider-query" ||
        node.settings.source === "window"
        ? {
            id: node.settings.operation,
            as: "source",
            needsWindow: node.settings.source === "window",
          }
        : undefined;
    case "lookup":
      return { id: node.settings.operation, as: "lookup", needsWindow: false };
    case "action":
      return { id: node.settings.operation, as: "action", needsWindow: false };
    case "agent":
      return {
        id: `${node.settings.agent}.${node.settings.op}`,
        as: "agent",
        needsWindow: false,
      };
    case "wait":
      return node.settings.wait === "condition"
        ? { id: node.settings.operation, as: "lookup", needsWindow: false }
        : undefined;
    default:
      return undefined;
  }
}

/** The argument bindings a node hands to the operation it runs; undefined for a node that runs none. */
export function operationArgs(
  node: WorkflowNode,
): Record<string, FieldBinding> | undefined {
  switch (node.kind) {
    case "source":
      return node.settings.source === "provider-query" ||
        node.settings.source === "window"
        ? node.settings.args
        : undefined;
    case "lookup":
    case "action":
    case "agent":
      return node.settings.args;
    case "wait":
      return node.settings.wait === "condition"
        ? node.settings.args
        : undefined;
    default:
      return undefined;
  }
}

/** A string with a `{{ }}` hole is an expression, so its value is not known until the run. */
function hasHole(text: string): boolean {
  try {
    return parseTemplate(text).parts.some((part) => part.type === "hole");
  } catch (error) {
    // A malformed hole is reported as `bad_reference`; it is no constant to check here.
    if (error instanceof ExpressionError) return true;
    throw error;
  }
}

function describeJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

/** Every path a binding reads: its path, or the holes in a fixed value's text. A malformed one is `bad_reference`'s to report, so it reads nothing here. */
function pathsOfBinding(binding: FieldBinding): ParsedPath[] {
  try {
    if (binding.mode === "path") return [parsePath(binding.path)];
    if (binding.mode === "fixed") {
      return stringsIn(binding.value).flatMap((text) => collectPaths(text));
    }
  } catch (error) {
    if (error instanceof ExpressionError) return [];
    throw error;
  }
  return [];
}

/**
 * Why a binding's value is model-written, or undefined. A model writes it when
 * the binding is `ai`, or reads the result of an AI step. A fixed value, a
 * setting, an item field and a lookup's result are not the model's.
 */
function modelWrittenReason(
  binding: FieldBinding,
  aiScopeKeys: ReadonlySet<string>,
): string | undefined {
  if (binding.mode === "ai") return "it is written by the AI";
  for (const path of pathsOfBinding(binding)) {
    const [name] = path.segments;
    if (
      path.root === "nodes" &&
      typeof name === "string" &&
      aiScopeKeys.has(name)
    ) {
      return `it reads the AI step "${name}"`;
    }
  }
  return undefined;
}

/**
 * Checks the arguments a node binds against the fields its operation declares.
 * Only a fixed constant is checked for value and type; a path or AI-written
 * binding, and a fixed string with a `{{ }}` hole, only has to name a field.
 * A `target` field, which decides who or where an effect lands, may not be
 * model-written unless its catalog entry says that was reviewed.
 */
function fieldIssues(
  node: WorkflowNode,
  def: OperationDefinition,
  args: Record<string, FieldBinding>,
  aiScopeKeys: ReadonlySet<string>,
): WorkflowIssue[] {
  const issue = (code: WorkflowIssueCode, detail: string): WorkflowIssue => ({
    code,
    nodeId: node.id,
    detail,
  });
  const fields = new Map(def.fields.map((field) => [field.name, field]));
  const found: WorkflowIssue[] = [];

  for (const [name, binding] of Object.entries(args)) {
    const field = fields.get(name);
    if (!field) {
      found.push(issue("unknown_field", `${def.id} has no field "${name}"`));
      continue;
    }
    if (field.target && !field.modelMayWrite) {
      const reason = modelWrittenReason(binding, aiScopeKeys);
      if (reason) {
        found.push(
          issue(
            "model_written_target",
            `args.${name} decides who or where ${def.id} lands, and ${reason}. Type it in, or read it from a setting, an item field or a lookup.`,
          ),
        );
      }
    }
    if (binding.mode !== "fixed") continue;
    const { value } = binding;
    if (typeof value === "string" && hasHole(value)) continue;
    const mismatch = (expected: string) =>
      found.push(
        issue(
          "field_type_mismatch",
          `args.${name}: expected ${expected} but got ${describeJson(value)}`,
        ),
      );
    switch (field.type) {
      case "string":
      case "text":
        if (typeof value !== "string") mismatch("a string");
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          mismatch("a number");
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") mismatch("a boolean");
        break;
      case "enum":
        if (typeof value !== "string") mismatch("one of the listed values");
        else if (!field.enum?.includes(value)) {
          found.push(
            issue(
              "enum_value_invalid",
              `args.${name}: "${value}" is not one of ${(field.enum ?? []).join(", ")}`,
            ),
          );
        }
        break;
      case "json":
        break;
    }
  }

  for (const field of def.fields) {
    // A default fills the field when the node leaves it out.
    if (
      field.required &&
      field.default === undefined &&
      !Object.prototype.hasOwnProperty.call(args, field.name)
    ) {
      found.push(
        issue("missing_required_field", `${def.id} needs "${field.name}"`),
      );
    }
  }
  return found;
}

/**
 * Checks that a graph is complete enough to save. "Upstream" means reachable
 * backwards over forward edges only, so a back-edge never makes a later node
 * readable by an earlier one. A reference only has to be upstream along some
 * path; whether it holds a value on a given item is a runtime error, not a
 * save-time one.
 */
export function validateWorkflowGraph(
  graph: WorkflowGraph,
  catalog: OperationCatalog,
): WorkflowValidation {
  const issues: WorkflowIssue[] = [];
  const add = (issue: WorkflowIssue) => {
    issues.push(issue);
  };

  const nodesById = new Map<string, WorkflowNode>();
  const scopeKeys = new Map<string, WorkflowNode>();
  for (const node of graph.nodes) {
    if (nodesById.has(node.id))
      add({ code: "duplicate_node_id", nodeId: node.id });
    else nodesById.set(node.id, node);
    const key = nodeScopeKey(node);
    if (scopeKeys.has(key)) {
      add({ code: "duplicate_node_name", nodeId: node.id, detail: key });
    } else {
      scopeKeys.set(key, node);
    }
    if (node.kind === "switch") {
      const routeIds = new Set<string>();
      for (const route of node.settings.routes) {
        if (routeIds.has(route.id)) {
          add({
            code: "duplicate_switch_route",
            nodeId: node.id,
            detail: route.id,
          });
        }
        routeIds.add(route.id);
      }
    }
  }

  const triggers = graph.nodes.filter((node) => node.kind === "trigger");
  if (triggers.length !== 1) {
    add({
      code: "trigger_count",
      detail: `a workflow has exactly one trigger, found ${triggers.length}`,
    });
  }

  const edgeIds = new Set<string>();
  const flow: WorkflowEdge[] = [];
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id))
      add({ code: "duplicate_edge_id", edgeId: edge.id });
    edgeIds.add(edge.id);
    const from = nodesById.get(edge.from.node);
    const to = nodesById.get(edge.to.node);
    if (!from || !to) {
      add({
        code: "edge_unknown_node",
        edgeId: edge.id,
        nodeId: from ? edge.to.node : edge.from.node,
      });
      continue;
    }
    // `limitReached` belongs to the loop's exit, never to the back-edge itself.
    const ports = edge.back ? portsFor(from) : portsWithLimit(graph, from);
    if (!ports.includes(edge.from.port)) {
      add({
        code: "edge_unknown_port",
        edgeId: edge.id,
        nodeId: from.id,
        port: edge.from.port,
      });
      continue;
    }
    if (to.kind === "trigger") {
      add({ code: "edge_into_trigger", edgeId: edge.id, nodeId: to.id });
      continue;
    }
    flow.push(edge);
  }

  const connected = new Set(
    graph.edges.map((edge) => `${edge.from.node}\n${edge.from.port}`),
  );
  for (const node of graph.nodes) {
    for (const port of portsWithLimit(graph, node)) {
      if (!connected.has(`${node.id}\n${port}`)) {
        add({ code: "port_leads_nowhere", nodeId: node.id, port });
      }
    }
  }

  const backEdges = flow.filter((edge) => edge.back);
  const forwardEdges = flow.filter((edge) => !edge.back);
  const forward = adjacency(forwardEdges);
  const forwardReverse = adjacency(forwardEdges, true);

  for (const id of cycleEntries([...nodesById.keys()], forward)) {
    add({ code: "cycle_without_back_edge", nodeId: id });
  }

  if (triggers.length > 0) {
    const all = adjacency(flow);
    const live = new Set(
      triggers.flatMap((trigger) => [...reachable(trigger.id, all)]),
    );
    for (const node of graph.nodes) {
      if (!live.has(node.id))
        add({ code: "unreachable_node", nodeId: node.id });
    }
  }

  const loopAvoidsWait = (headId: string, tailId: string): boolean => {
    if (nodesById.get(headId)?.kind === "wait") return false;
    if (headId === tailId) return true;
    const seen = new Set([headId]);
    const queue = [headId];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      for (const target of forward.get(next) ?? []) {
        const kind = nodesById.get(target)?.kind;
        if (target === tailId) {
          if (kind !== "wait") return true;
        } else if (kind !== "wait" && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    return false;
  };

  const loops: { edge: WorkflowEdge; body: Set<string> }[] = [];
  const headsSeen = new Set<string>();
  for (const edge of backEdges) {
    const head = nodesById.get(edge.to.node);
    if (headsSeen.has(edge.to.node)) {
      add({
        code: "multiple_back_edges",
        edgeId: edge.id,
        nodeId: edge.to.node,
      });
    }
    headsSeen.add(edge.to.node);
    if (head?.kind === "source" && head.settings.source === "status") {
      add({
        code: "status_source_back_edge",
        edgeId: edge.id,
        nodeId: head.id,
      });
    }
    const downstream = reachable(edge.to.node, forward);
    if (!downstream.has(edge.from.node)) {
      add({
        code: "back_edge_without_cycle",
        edgeId: edge.id,
        nodeId: edge.to.node,
      });
      continue;
    }
    if (loopAvoidsWait(edge.to.node, edge.from.node)) {
      add({ code: "loop_without_wait", edgeId: edge.id, nodeId: edge.to.node });
    }
    const upstreamOfTail = reachable(edge.from.node, forwardReverse);
    loops.push({
      edge,
      body: new Set([...downstream].filter((id) => upstreamOfTail.has(id))),
    });
  }
  for (let later = 1; later < loops.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      const a = loops[earlier];
      const b = loops[later];
      if (a.edge.to.node === b.edge.to.node) continue;
      if ([...b.body].some((id) => a.body.has(id))) {
        add({ code: "nested_loop", edgeId: b.edge.id, nodeId: b.edge.to.node });
        break;
      }
    }
  }

  const aiScopeKeys = new Set(
    graph.nodes.filter((node) => node.kind === "ai").map(nodeScopeKey),
  );
  for (const node of graph.nodes) {
    const use = operationUse(node);
    if (!use) continue;
    const def = catalog.get(use.id);
    if (!def) {
      add({ code: "unknown_operation", nodeId: node.id, detail: use.id });
      continue;
    }
    const mismatch =
      !isWriteAllowedForNode(def, use.as) ||
      (use.as === "action" && def.effect !== "write") ||
      (use.needsWindow && !def.window) ||
      (node.kind === "agent" &&
        (def.implementation.type !== "builder" ||
          def.implementation.op !== node.settings.op ||
          def.effect !== (node.settings.op === "check" ? "read" : "write")));
    if (mismatch) {
      add({
        code: "operation_kind_mismatch",
        nodeId: node.id,
        detail: `${use.id} cannot run as a ${node.kind} node`,
      });
      continue;
    }
    const args = operationArgs(node);
    if (args) fieldIssues(node, def, args, aiScopeKeys).forEach(add);
  }

  for (const node of graph.nodes) {
    if (node.kind !== "ai") continue;
    for (const tool of node.settings.tools) {
      const def = catalog.get(tool);
      if (!def) {
        add({
          code: "unknown_tool",
          nodeId: node.id,
          detail: `${tool} is not an operation Factory has`,
        });
      } else if (def.effect !== "read") {
        add({
          code: "unknown_tool",
          nodeId: node.id,
          detail: `${tool} writes, and a model may only be given reads`,
        });
      }
    }
  }

  const upstreamCache = new Map<string, Set<string>>();
  const upstreamOf = (nodeId: string): Set<string> => {
    let upstream = upstreamCache.get(nodeId);
    if (!upstream) {
      upstream = reachable(nodeId, forwardReverse);
      upstream.delete(nodeId);
      upstreamCache.set(nodeId, upstream);
    }
    return upstream;
  };

  const badReference = (node: WorkflowNode, where: string, why: string) =>
    add({ code: "bad_reference", nodeId: node.id, detail: `${where}: ${why}` });

  const checkParsedPath = (
    node: WorkflowNode,
    where: string,
    text: string,
    path: ParsedPath,
  ) => {
    if (path.root !== "nodes") return;
    const [name] = path.segments;
    if (typeof name !== "string") {
      return badReference(
        node,
        where,
        `"${text}" must name a node after "nodes."`,
      );
    }
    const target = scopeKeys.get(name);
    if (!target) return badReference(node, where, `no node is named "${name}"`);
    if (!upstreamOf(node.id).has(target.id)) {
      badReference(node, where, `"${name}" is not upstream of this node`);
    }
  };

  for (const node of graph.nodes) {
    for (const expression of expressionsOf(node)) {
      if (expression.kind === "path") {
        const check = validatePath(expression.text);
        if (!check.ok) {
          badReference(node, expression.where, check.error.message);
        } else {
          checkParsedPath(node, expression.where, expression.text, check.path);
        }
        continue;
      }
      try {
        for (const part of parseTemplate(expression.text).parts) {
          if (part.type === "hole") {
            checkParsedPath(node, expression.where, part.path, part);
          }
        }
      } catch (error) {
        if (!(error instanceof ExpressionError)) throw error;
        badReference(node, expression.where, error.message);
      }
    }
    if (
      node.kind === "wait" &&
      node.settings.wait === "reply" &&
      node.settings.watch
    ) {
      const { fromNode } = node.settings.watch;
      if (!upstreamOf(node.id).has(fromNode)) {
        badReference(node, "watch", `"${fromNode}" is not an upstream node`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
