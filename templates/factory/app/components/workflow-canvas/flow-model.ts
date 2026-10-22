import type { Edge, Node } from "@xyflow/react";

import {
  nodeSize,
  portsWithLimit,
  routePort,
  showsPortRows,
  type EditorValidation,
  type Selection,
  type Size,
  type WorkflowCatalog,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowIssue,
  type WorkflowNode,
} from "@/lib/workflow-editor";

import { describeNode, nodeTitle } from "./node-summary";
import type { StepOverlay, WorkflowOverlay } from "./overlay";
import type { WorkflowCanvasStrings } from "./strings";

export const TARGET_HANDLE = "in";

/** Adds the next step after one output of a step. */
export type AddAfterHandler = (nodeId: string, port: string) => void;

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
  /** The name under the tile: the person's label, or one derived from the step. */
  title: string;
  /** The line under the title: what the step does. */
  subtitle: string;
  size: Size;
  ports: PortView[];
  showPortRows: boolean;
  issues: WorkflowIssue[];
  /** Providers this step needs that are not connected. */
  unconnected: readonly string[];
  step?: StepOverlay;
  state: FlowState;
  /** The run is on this step: its ring turns until the next step starts. */
  current: boolean;
  readOnly: boolean;
  /** Absent where the canvas cannot be edited. React Flow mounts the card with no props of its own, so this travels here. */
  onAddAfter?: AddAfterHandler;
}

export interface WorkflowEdgeData extends Record<string, unknown> {
  edge: WorkflowEdge;
  /** Items through this connection in the shown run. Absent where the source labels its outputs instead. */
  count?: number;
  /** Items went along this connection in the shown run. A zero count is not a flow. */
  flowed: boolean;
  /** The source step ran more than once, so `count` is a total over its passes. */
  repeated: boolean;
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
  onAddAfter?: AddAfterHandler;
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
    onAddAfter,
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
    const title = nodeTitle(node, catalog, s);
    const summary = describeNode(node, catalog, s);
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
        title,
        // A summary that repeats the title (an operation's own label) is left out.
        subtitle: summary === title ? "" : summary,
        size: nodeSize(graph, node),
        ports,
        showPortRows: showsPortRows(ports.map((port) => port.id)),
        issues,
        unconnected: unconnected?.[node.id] ?? [],
        step,
        state: stateOf(overlay, overlay?.litNodeIds, node.id),
        current: overlay?.currentNodeId === node.id,
        readOnly,
        onAddAfter,
      },
    };
  });
}

export function toFlowEdges(args: {
  graph: WorkflowGraph;
  validation: EditorValidation;
  overlay?: WorkflowOverlay;
  selection: Selection;
  /** The connection under the pointer rises above its neighbours. */
  hoveredEdgeId?: string;
}): WorkflowFlowEdge[] {
  const { graph, validation, overlay, selection, hoveredEdgeId } = args;
  const selected = new Set(selection.edgeIds);
  const lanes = new Map<string, number>();
  return graph.edges
    .filter((edge) => drawable(graph, edge))
    .map((edge) => {
      const span = `${edge.to.node}`;
      const lane = edge.back ? (lanes.get(span) ?? 0) : 0;
      if (edge.back) lanes.set(span, lane + 1);
      const source = graph.nodes.find((node) => node.id === edge.from.node);
      const sourceStep = overlay?.stepByNodeId?.[edge.from.node];
      const portCount = sourceStep?.ports[edge.from.port]?.count;
      // A node with labelled outputs already shows each count beside its output.
      const labelled =
        source !== undefined && showsPortRows(portsWithLimit(graph, source));
      const state = stateOf(overlay, overlay?.litEdgeIds, edge.id);
      return {
        id: edge.id,
        type: edge.back ? "back" : "forward",
        source: edge.from.node,
        target: edge.to.node,
        sourceHandle: edge.from.port,
        targetHandle: TARGET_HANDLE,
        selected: selected.has(edge.id),
        zIndex: edge.id === hoveredEdgeId ? 1 : 0,
        deletable: false,
        focusable: true,
        data: {
          edge,
          count: labelled ? undefined : portCount,
          // Without a count for the port, a connection an item's path lights still counts as flowed.
          flowed: portCount === undefined ? state === "lit" : portCount > 0,
          repeated: (sourceStep?.passes ?? 1) > 1,
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
