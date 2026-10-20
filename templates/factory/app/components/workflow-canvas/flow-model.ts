import type { Edge, Node } from "@xyflow/react";

import {
  portsWithLimit,
  routePort,
  showsPortRows,
  type EditorValidation,
  type Selection,
  type WorkflowCatalog,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowIssue,
  type WorkflowNode,
} from "@/lib/workflow-editor";

import { describeNode } from "./node-summary";
import type { StepOverlay, WorkflowOverlay } from "./overlay";
import type { WorkflowCanvasStrings } from "./strings";

export const TARGET_HANDLE = "in";

export interface PortView {
  id: string;
  label: string;
  count?: number;
  connected: boolean;
  issues: WorkflowIssue[];
}

type FlowState = "default" | "lit" | "dimmed";

interface WorkflowNodeData extends Record<string, unknown> {
  node: WorkflowNode;
  subtitle: string;
  ports: PortView[];
  showPortRows: boolean;
  issues: WorkflowIssue[];
  /** Providers this step needs that are not connected. */
  unconnected: readonly string[];
  step?: StepOverlay;
  state: FlowState;
  readOnly: boolean;
}

export interface WorkflowEdgeData extends Record<string, unknown> {
  edge: WorkflowEdge;
  count?: number;
  issues: WorkflowIssue[];
  /** Loops that share a stretch of canvas take different lanes. */
  lane: number;
  state: FlowState;
}

export type WorkflowFlowNode = Node<WorkflowNodeData, "workflow">;
export type WorkflowFlowEdge = Edge<WorkflowEdgeData, "forward" | "back">;

export function portLabel(
  node: WorkflowNode,
  port: string,
  s: WorkflowCanvasStrings,
): string {
  if (node.kind === "switch" && port.startsWith("route:")) {
    const route = node.settings.routes.find((r) => routePort(r.id) === port);
    if (route) return route.label;
  }
  return s.port[port] ?? port;
}

function stateOf(
  overlay: WorkflowOverlay | undefined,
  lit: string[] | undefined,
  id: string,
): FlowState {
  if (!overlay || lit === undefined) return "default";
  return lit.includes(id) ? "lit" : "dimmed";
}

/** Edges whose source handle cannot be drawn: their issues are shown on the steps at their ends. */
function drawable(graph: WorkflowGraph, edge: WorkflowEdge): boolean {
  const from = graph.nodes.find((node) => node.id === edge.from.node);
  const to = graph.nodes.find((node) => node.id === edge.to.node);
  if (!from || !to || to.kind === "trigger") return false;
  return portsWithLimit(graph, from).includes(edge.from.port);
}

export function toFlowNodes(args: {
  graph: WorkflowGraph;
  catalog: WorkflowCatalog;
  validation: EditorValidation;
  overlay?: WorkflowOverlay;
  unconnected?: Readonly<Record<string, readonly string[]>>;
  selection: Selection;
  readOnly: boolean;
  strings: WorkflowCanvasStrings;
}): WorkflowFlowNode[] {
  const {
    graph,
    catalog,
    validation,
    overlay,
    unconnected,
    selection,
    readOnly,
    strings: s,
  } = args;
  const selected = new Set(selection.nodeIds);
  const connected = new Set(
    graph.edges.map((edge) => `${edge.from.node}\n${edge.from.port}`),
  );
  const undrawnIssues = new Map<string, WorkflowIssue[]>();
  for (const edge of graph.edges) {
    if (drawable(graph, edge)) continue;
    const issues = validation.byEdge[edge.id] ?? [];
    for (const id of [edge.from.node, edge.to.node]) {
      undrawnIssues.set(id, [...(undrawnIssues.get(id) ?? []), ...issues]);
    }
  }
  return graph.nodes.map((node) => {
    const step = overlay?.stepByNodeId?.[node.id];
    const issues = [
      ...(validation.byNode[node.id] ?? []),
      ...(undrawnIssues.get(node.id) ?? []),
    ];
    const ports = portsWithLimit(graph, node).map(
      (id): PortView => ({
        id,
        label: portLabel(node, id, s),
        count: step?.ports[id]?.count,
        connected: connected.has(`${node.id}\n${id}`),
        issues: issues.filter((issue) => issue.port === id),
      }),
    );
    return {
      id: node.id,
      type: "workflow",
      position: node.position,
      selected: selected.has(node.id),
      draggable: !readOnly,
      connectable: !readOnly,
      deletable: false,
      data: {
        node,
        subtitle: describeNode(node, catalog, s),
        ports,
        showPortRows: showsPortRows(ports.map((port) => port.id)),
        issues,
        unconnected: unconnected?.[node.id] ?? [],
        step,
        state: stateOf(overlay, overlay?.litNodeIds, node.id),
        readOnly,
      },
    };
  });
}

export function toFlowEdges(args: {
  graph: WorkflowGraph;
  validation: EditorValidation;
  overlay?: WorkflowOverlay;
  selection: Selection;
}): WorkflowFlowEdge[] {
  const { graph, validation, overlay, selection } = args;
  const selected = new Set(selection.edgeIds);
  const lanes = new Map<string, number>();
  return graph.edges
    .filter((edge) => drawable(graph, edge))
    .map((edge) => {
      const span = `${edge.to.node}`;
      const lane = edge.back ? (lanes.get(span) ?? 0) : 0;
      if (edge.back) lanes.set(span, lane + 1);
      // A node with labelled outputs already shows each count beside its output.
      const source = graph.nodes.find((node) => node.id === edge.from.node);
      const count =
        source && !showsPortRows(portsWithLimit(graph, source))
          ? overlay?.stepByNodeId?.[edge.from.node]?.ports[edge.from.port]
              ?.count
          : undefined;
      const state = stateOf(overlay, overlay?.litEdgeIds, edge.id);
      return {
        id: edge.id,
        type: edge.back ? "back" : "forward",
        source: edge.from.node,
        target: edge.to.node,
        sourceHandle: edge.from.port,
        targetHandle: TARGET_HANDLE,
        selected: selected.has(edge.id),
        deletable: false,
        focusable: true,
        data: {
          edge,
          count,
          issues: validation.byEdge[edge.id] ?? [],
          lane,
          state,
        },
      };
    });
}

/**
 * Carries what React Flow knows and the graph does not onto freshly built
 * nodes: measured sizes, and the position of a node that is mid-drag.
 */
export function reconcileNodes(
  previous: readonly WorkflowFlowNode[],
  next: readonly WorkflowFlowNode[],
): WorkflowFlowNode[] {
  const before = new Map(previous.map((node) => [node.id, node]));
  return next.map((node) => {
    const old = before.get(node.id);
    if (!old) return node;
    return {
      ...node,
      measured: old.measured,
      dragging: old.dragging,
      position: old.dragging ? old.position : node.position,
    };
  });
}
