import type { StepStatus } from "@/lib/workflow-editor";

import type { StepOverlay, WorkflowOverlay } from "../workflow-canvas/overlay";

interface StepLike {
  nodeId: string;
  status: StepStatus;
  error?: { code: string; message: string } | null;
  ports: Record<string, { count: number }>;
}

// A step's `ports` also carries `parked`, the number of items it left waiting.
// That is a count, not an output: it must never become a port or an edge.
const PARKED_COUNT_KEY = "parked";

// A node can have several steps in one run (a loop passes through it again).
// The canvas shows one status, so the one that most needs a look wins.
const STATUS_RANK: Record<StepStatus, number> = {
  failed: 4,
  needs_check: 3,
  running: 2,
  succeeded: 1,
  skipped: 0,
};

/** Status and per-port counts for each node a run touched, summed across its passes. */
export function stepOverlayFromSteps(
  steps: readonly StepLike[],
): Record<string, StepOverlay> {
  const byNode: Record<string, StepOverlay> = {};
  for (const step of steps) {
    const existing = byNode[step.nodeId];
    const ports: Record<string, { count: number }> = { ...existing?.ports };
    for (const [port, { count }] of Object.entries(step.ports)) {
      if (port === PARKED_COUNT_KEY) continue;
      ports[port] = { count: (ports[port]?.count ?? 0) + count };
    }
    // The step that decides the status is the one whose reason is shown.
    const shown =
      existing && STATUS_RANK[existing.status] >= STATUS_RANK[step.status]
        ? existing
        : step;
    byNode[step.nodeId] = {
      status: shown.status,
      ...(shown.error ? { error: shown.error } : {}),
      ports,
    };
  }
  return byNode;
}

/** The step that failed is explained in Audit, so selecting it opens there. */
export function openingTab(
  step: StepOverlay | undefined,
): "settings" | "audit" {
  return step?.status === "failed" ? "audit" : "settings";
}

/** The canvas overlay for a run, or nothing when no run is showing. */
export function runOverlay(
  steps: readonly StepLike[] | undefined,
): WorkflowOverlay | undefined {
  return steps ? { stepByNodeId: stepOverlayFromSteps(steps) } : undefined;
}
