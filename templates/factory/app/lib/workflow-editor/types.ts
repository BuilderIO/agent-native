import type {
  NodeKind,
  OperationCatalog,
  OperationDefinition,
  WorkflowGraph,
  WorkflowIssue,
} from "./engine.js";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** What the editor needs from the operation registry: lookups to validate, a list to pick from. */
export interface WorkflowCatalog extends OperationCatalog {
  list(): readonly OperationDefinition[];
}

export interface Selection {
  nodeIds: string[];
  edgeIds: string[];
}

export const EMPTY_SELECTION: Selection = { nodeIds: [], edgeIds: [] };

const REJECTION_CODES = [
  "unknown_node",
  "unknown_edge",
  "unknown_port",
  "edge_into_trigger",
  "self_loop",
  "duplicate_connection",
  "limit_port_back_edge",
  "trigger_exists",
  "node_limit",
  "edge_limit",
  "operation_required",
  "operation_mismatch",
  "invalid_name",
  "duplicate_name",
  "invalid_settings",
  "invalid_iterations",
  "invalid_position",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface SettingsIssue {
  path: (string | number)[];
  message: string;
}

export interface Rejection {
  code: RejectionCode;
  /** For logs and tests; the UI words each code itself. */
  message: string;
  /** The schema problems behind `invalid_settings`, relative to the node's settings. */
  issues?: SettingsIssue[];
}

export type Outcome<Extra extends object = object> =
  | ({ ok: true } & Extra)
  | { ok: false; rejection: Rejection };

export type GraphEdit<Extra extends object = object> =
  | ({ ok: true; graph: WorkflowGraph; selection?: Selection } & Extra)
  | { ok: false; rejection: Rejection };

export function reject(
  code: RejectionCode,
  message: string,
  issues?: SettingsIssue[],
): { ok: false; rejection: Rejection } {
  return {
    ok: false,
    rejection: issues ? { code, message, issues } : { code, message },
  };
}

export const DEFAULT_MAX_ITERATIONS = 3;

export interface BackEdgeInput {
  maxIterations: number;
}

/** Which input a source node starts from; the other kinds with variants are listed in `NodeVariant`. */
export type NodeVariant =
  | "inbox-poll"
  | "status"
  | "provider-query"
  | "window"
  | "reply"
  | "time"
  | "condition"
  | "list"
  | "count"
  | "groupBy"
  | "summarize";

export interface NewNodeOptions {
  operationId?: string;
  variant?: NodeVariant;
  /** Top-left corner; placed beside `after` or in free space when omitted. */
  position?: Point;
  /** Connects the new node from this output port of an existing node. */
  after?: { node: string; port: string };
}

export interface NodeReference {
  nodeId: string;
  /** Where in the node the name is read, such as `args.text`. */
  where: string;
}

export interface EditorValidation {
  ok: boolean;
  issues: WorkflowIssue[];
  byNode: Record<string, WorkflowIssue[]>;
  byEdge: Record<string, WorkflowIssue[]>;
  /** Issues that name neither a node nor an edge, such as the trigger count. */
  graphLevel: WorkflowIssue[];
}

export interface SelectionContext {
  nodeCount: number;
  edgeCount: number;
  selectedNodes: {
    id: string;
    name: string;
    kind: NodeKind;
    operation?: string;
  }[];
  selectedEdges: {
    id: string;
    from: string;
    port: string;
    to: string;
    back?: true;
  }[];
  /** True when more nodes or edges are selected than are listed. */
  truncated: boolean;
}
