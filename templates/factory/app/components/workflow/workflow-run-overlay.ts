import type { StepStatus } from "@/lib/workflow-editor";

import type { StepOverlay, WorkflowOverlay } from "../workflow-canvas/overlay";

interface StepLike {
  nodeId: string;
  status: StepStatus;
  // The engine keeps a node's first start for the whole run, even when a loop
  // runs it again, so this is the first pass's start.
  startedAt: string;
  error?: { code: string; message: string } | null;
  ports: Record<string, { count: number }>;
  /** How many passes the row covers. Absent means one. */
  passes?: number;
}

// A step's `ports` also carries `parked`, the number of items it left waiting.
// That is a count, not an output: it must never become a port or an edge.
const PARKED_COUNT_KEY = "parked";

// The engine keeps one step row per node per run and merges a loop's later
// passes into it. A row that arrives separately is still combined here, and the
// status that most needs a look wins.
const STATUS_RANK: Record<StepStatus, number> = {
  failed: 4,
  needs_check: 3,
  running: 2,
  succeeded: 1,
  skipped: 0,
};

/** Status, per-port counts and passes for each node a run touched, summed across its rows. */
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
      passes: (existing?.passes ?? 0) + (step.passes ?? 1),
    };
  }
  return byNode;
}

/** The node of the step that started last. A tie goes to the step listed later. */
function latestNodeId(steps: readonly StepLike[]): string | undefined {
  let latest: StepLike | undefined;
  for (const step of steps) {
    if (!latest || Date.parse(step.startedAt) >= Date.parse(latest.startedAt)) {
      latest = step;
    }
  }
  return latest?.nodeId;
}

/** The step that failed is explained in Audit, so selecting it opens there. */
export function openingTab(
  step: StepOverlay | undefined,
): "settings" | "audit" {
  return step?.status === "failed" ? "audit" : "settings";
}

/**
 * The canvas overlay for a run, or nothing when no run is showing. The node the
 * run is on is the one that started last, and only while the run is going.
 * `running` says whether it is; without it, the run counts as going while any
 * step is still running.
 */
export function runOverlay(
  steps: readonly StepLike[] | undefined,
  options: { running?: boolean } = {},
): WorkflowOverlay | undefined {
  if (!steps) return undefined;
  const running =
    options.running ?? steps.some((step) => step.status === "running");
  const currentNodeId = running ? latestNodeId(steps) : undefined;
  return {
    stepByNodeId: stepOverlayFromSteps(steps),
    ...(currentNodeId === undefined ? {} : { currentNodeId }),
  };
}
