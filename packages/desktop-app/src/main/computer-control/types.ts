export type AgentExecutionMode = "plan" | "act";

export interface ComputerScope {
  /** macOS application bundle identifiers that this task may control. */
  bundleIds: readonly string[];
  /** Exact web origins. Paths, query strings, and wildcards are intentionally unsupported. */
  origins: readonly string[];
}

export interface SemanticTarget {
  snapshotId: string;
  nodeId: string;
  bundleId: string;
  origin?: string;
  expectedRole?: string;
}

export interface SemanticNode {
  id: string;
  role: string;
  title?: string;
  value?: string;
  frame?: { x: number; y: number; width: number; height: number };
  children?: SemanticNode[];
}

export interface SemanticSnapshot {
  snapshotId: string;
  bundleId: string;
  applicationName?: string;
  origin?: string;
  capturedAt: string;
  nodes: SemanticNode[];
}

export type ObserveOperation = {
  kind: "observe.snapshot";
  taskId: string;
};

interface MutationBase {
  taskId: string;
  leaseToken: string;
  target: SemanticTarget;
}

export type MutationOperation =
  | (MutationBase & { kind: "input.click"; button?: "left" | "right" })
  | (MutationBase & { kind: "input.type"; text: string })
  | (MutationBase & {
      kind: "input.key";
      key: string;
      modifiers?: readonly string[];
    })
  | (MutationBase & { kind: "input.scroll"; deltaX: number; deltaY: number });

export type ComputerOperation = ObserveOperation | MutationOperation;

export interface ComputerLease {
  taskId: string;
  token: string;
  scope: ComputerScope;
  issuedAt: number;
  expiresAt: number;
}

export interface ComputerAuditEvent {
  taskId: string;
  operation: ComputerOperation["kind"] | "control.kill" | "control.takeover";
  outcome: "allowed" | "blocked" | "succeeded" | "failed";
  at: string;
  metadata: Record<string, string | number | boolean | undefined>;
}

export interface ComputerPermissionStatus {
  screenRecording:
    | "not-determined"
    | "granted"
    | "denied"
    | "restricted"
    | "unknown";
  accessibility: boolean;
}
