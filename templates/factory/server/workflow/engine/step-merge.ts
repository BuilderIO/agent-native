import type { StepRecord, StepStatus } from "../contract.js";
import { MAX_INLINE_ITEMS } from "../items.js";
import { boundStepFields } from "./step-builder.js";

// A node that runs twice in one tick (a Wait woken before its upstream runs,
// or a loop pass) keeps one step row, because a step is keyed by (run, node).
const SEVERITY: Readonly<Record<StepStatus, number>> = {
  skipped: 0,
  running: 1,
  succeeded: 2,
  needs_check: 3,
  failed: 4,
};

function mergeFields(
  earlier: StepRecord["fields"],
  later: StepRecord["fields"],
): StepRecord["fields"] {
  if (!earlier || !later) return later ?? earlier;
  const merged: Record<string, unknown> = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    const before = merged[key];
    merged[key] =
      typeof before === "number" && typeof value === "number"
        ? before + value
        : value;
  }
  return merged;
}

/**
 * The step for a node that ran more than once: totals add up, the worst status
 * and the first error win, so a later clean pass cannot hide an earlier failure.
 */
export function mergeStepRecords(
  earlier: StepRecord,
  later: StepRecord,
): StepRecord {
  const ports: StepRecord["ports"] = {};
  for (const name of new Set([
    ...Object.keys(earlier.ports),
    ...Object.keys(later.ports),
  ])) {
    const before = earlier.ports[name];
    const after = later.ports[name];
    ports[name] = {
      count: (before?.count ?? 0) + (after?.count ?? 0),
      itemIds: [...(before?.itemIds ?? []), ...(after?.itemIds ?? [])].slice(
        0,
        MAX_INLINE_ITEMS,
      ),
    };
  }
  const status =
    SEVERITY[earlier.status] >= SEVERITY[later.status]
      ? earlier.status
      : later.status;
  const joined = mergeFields(earlier.fields, later.fields);
  const fields = joined === undefined ? undefined : boundStepFields(joined);
  const error = earlier.error ?? later.error;
  const receiptKeys = [
    ...(earlier.receiptKeys ?? []),
    ...(later.receiptKeys ?? []),
  ];
  const totalAvailable = Math.max(
    earlier.truncated?.totalAvailable ?? 0,
    later.truncated?.totalAvailable ?? 0,
  );
  return {
    runId: earlier.runId,
    nodeId: earlier.nodeId,
    status,
    mode: earlier.mode,
    startedAt: earlier.startedAt,
    ...(later.finishedAt === undefined ? {} : { finishedAt: later.finishedAt }),
    ports,
    ...(fields === undefined ? {} : { fields }),
    ...(earlier.truncated || later.truncated
      ? { truncated: { totalAvailable } }
      : {}),
    ...(earlier.inputTruncated || later.inputTruncated
      ? { inputTruncated: true }
      : {}),
    ...(error === undefined ? {} : { error }),
    ...(receiptKeys.length > 0 ? { receiptKeys } : {}),
    ...((earlier.agentThreadId ?? later.agentThreadId)
      ? { agentThreadId: earlier.agentThreadId ?? later.agentThreadId }
      : {}),
  };
}
