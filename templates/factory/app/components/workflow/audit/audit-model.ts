import type { ItemsStrings } from "../items-strings";
import type { NodeAudit, StepStatus } from "../items/read-types";

const STATUS_ORDER: readonly StepStatus[] = [
  "succeeded",
  "skipped",
  "running",
  "needs_check",
  "failed",
];

export interface StatusSegment {
  status: StepStatus;
  count: number;
  /** Share of all steps, 0 to 1. */
  fraction: number;
}

/** The non-empty statuses in a fixed order, so the same runs always draw the same bar. */
export function statusSegments(
  counts: NodeAudit["summary"]["statusCounts"],
): StatusSegment[] {
  const total = STATUS_ORDER.reduce(
    (sum, status) => sum + (counts[status] ?? 0),
    0,
  );
  if (total === 0) return [];
  return STATUS_ORDER.flatMap((status) => {
    const count = counts[status] ?? 0;
    return count > 0 ? [{ status, count, fraction: count / total }] : [];
  });
}

/** "18 done, 2 failed": the words a screen reader gets for the bar. */
export function segmentsLabel(
  segments: readonly StatusSegment[],
  s: ItemsStrings,
): string {
  return segments
    .map((segment) => `${segment.count} ${s.audit.stepStatus[segment.status]}`)
    .join(s.listSeparator);
}

const AGENT_TEXT_CHARS = 200;
const AGENT_ERRORS = 5;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** What the agent is told about a node: ids to read the rest from and the failure picture, clipped. */
export function auditAgentContext(factoryId: string, audit: NodeAudit): string {
  return JSON.stringify({
    view: "node-audit",
    factoryId,
    workflowId: audit.workflow.id,
    workflowName: clip(audit.workflow.name, AGENT_TEXT_CHARS),
    graphVersion: audit.graphVersion,
    nodeId: audit.node.id,
    nodeName: clip(audit.node.name, AGENT_TEXT_CHARS),
    nodeKind: audit.node.kind,
    runId: audit.runId,
    steps: audit.summary.steps,
    statusCounts: audit.summary.statusCounts,
    failureRate: audit.summary.failureRate,
    errors: audit.errors.byCode.slice(0, AGENT_ERRORS).map((error) => ({
      code: error.code,
      steps: error.steps,
      lastMessage: clip(error.lastMessage, AGENT_TEXT_CHARS),
      lastRunId: error.lastRunId,
    })),
  });
}
