import type { StepStatus } from "@/lib/workflow-editor";

export interface StepOverlay {
  status: StepStatus;
  /** Why the step ended as it did, when the run recorded a reason. */
  error?: { code: string; message: string };
  /** Items that left through each output port in the run being shown. */
  ports: Record<string, { count: number }>;
  /** How many times the node ran in the run being shown. Absent when the run does not record it. */
  passes?: number;
}

/**
 * Run data drawn over the graph: status and counts from recorded steps, and
 * the nodes and edges an item passed through. Everything is optional; a
 * canvas without an overlay is the plain editor.
 */
export interface WorkflowOverlay {
  stepByNodeId?: Record<string, StepOverlay>;
  /** The node the run is on: its step started last, and it keeps the running ring until the next step starts. */
  currentNodeId?: string;
  /** When given, nodes and edges outside these are drawn faded. */
  litNodeIds?: string[];
  litEdgeIds?: string[];
}
