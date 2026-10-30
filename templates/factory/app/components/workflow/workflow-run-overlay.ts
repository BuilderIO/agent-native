import type { NodeKind, StepStatus } from "@/lib/workflow-editor";

import type { StepOverlay, WorkflowOverlay } from "../workflow-canvas/overlay";

interface StepLike {
  nodeId: string;
  /** Null when the run's version of the graph has no such node. */
  nodeKind?: NodeKind | null;
  status: StepStatus;
  // The engine keeps a node's first start for the whole run, even when a loop
  // runs it again, so this is the first pass's start.
  startedAt: string;
  error?: { code: string; message: string } | null;
  ports: Record<string, { count: number }>;
  /** What the engine noted on the step; `in` is how many items reached it. Null when the row was too big to return. */
  fields?: Record<string, unknown> | null;
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

// The engine runs every node below a source over whatever reached it, even
// nothing, and records that as a clean step. A step that took nothing in and
// sent nothing out did no work in this run, so it draws no mark; a Trigger and
// a Source start work on their own. A row that cannot say what reached it, or
// what it is, is shown as recorded.
function ranOverNothing(step: StepLike): boolean {
  const { nodeKind, fields } = step;
  if (step.status !== "succeeded" || !nodeKind) return false;
  if (nodeKind === "trigger" || nodeKind === "source") return false;
  if (typeof fields?.in !== "number" || fields.in > 0) return false;
  return Object.values(step.ports).every(({ count }) => count === 0);
}

/** Status, per-port counts and passes for each node a run did work in, summed across its rows. */
export function stepOverlayFromSteps(
  steps: readonly StepLike[],
): Record<string, StepOverlay> {
  const byNode: Record<string, StepOverlay> = {};
  for (const step of steps) {
    if (ranOverNothing(step)) continue;
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

/**
 * What a run has recorded so far, as a string that changes when any step's
 * status or port counts do. A read of a step's items made before the step
 * finished differs from one made after it, and this tells the two apart
 * without having watched the run go by. Empty when nothing is recorded.
 */
export function recordedStepsKey(
  byNode: Readonly<Record<string, StepOverlay>> | undefined,
): string {
  return Object.entries(byNode ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([nodeId, step]) => {
      const counts = Object.entries(step.ports)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([port, { count }]) => `${port}=${count}`)
        .join(",");
      return `${nodeId}:${step.status}:${step.passes ?? 1}:${counts}`;
    })
    .join(";");
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
