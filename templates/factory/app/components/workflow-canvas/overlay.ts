import type { StepStatus } from "@/lib/workflow-editor";

export interface StepOverlay {
  status: StepStatus;
  /** Why the step ended as it did, when the run recorded a reason. */
  error?: { code: string; message: string };
  /** Items that left through each output port in the run being shown. */
  ports: Record<string, { count: number }>;
}

/**
 * Run data drawn over the graph: status and counts from recorded steps, and
 * the nodes and edges an item passed through. Everything is optional; a
 * canvas without an overlay is the plain editor.
 */
export interface WorkflowOverlay {
  stepByNodeId?: Record<string, StepOverlay>;
  /** When given, nodes and edges outside these are drawn faded. */
  litNodeIds?: string[];
  litEdgeIds?: string[];
}
