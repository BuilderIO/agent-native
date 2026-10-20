import { SCHEDULE_STARTER } from "../../../server/workflow/contract.js";
import type { WorkflowCanvasStrings } from "../workflow-canvas/strings";
import type { ActionFailure } from "./workflow-errors";
import type { WorkflowStrings } from "./workflow-strings";
import { describeCron, type ScheduleSummary } from "./workflow-time";
import type {
  ListItemsResult,
  ListRunsResult,
  ListWorkflowsResult,
  RunView,
  WorkflowSummaryRow,
} from "./workflow-types";

/** A count of items that may be a floor: the page that held them was full. */
export interface ItemCount {
  count: number;
  atLeast: boolean;
}

type RunKnowledge =
  /** The newest run of this workflow in the page of recent runs. */
  | { known: true; run: RunView }
  /** No run exists for it: every run was read and none is this workflow's. */
  | { known: true; run: null }
  | {
      known: false;
      /** `pending`: not read yet. `failed`: the read failed. `older`: the page of recent runs was full and holds none of this workflow's. */
      why: "pending" | "failed" | "older";
    };

export interface WorkflowListRow {
  workflow: WorkflowSummaryRow;
  schedule: ScheduleSummary | null;
  lastRun: RunKnowledge;
  /** False when either item read failed or has not returned: the counts below are then not zero, they are unknown. */
  itemsKnown: boolean;
  parked: ItemCount;
  needsYou: ItemCount;
  /** Why this row floats to the top: its newest live run failed, its job was paused, or people have to look. */
  attention: "failed" | "paused" | "needs_you" | null;
}

function countByWorkflow(
  page: ListItemsResult | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of page?.items ?? []) {
    counts.set(item.workflowId, (counts.get(item.workflowId) ?? 0) + 1);
  }
  return counts;
}

/**
 * One row per workflow, joined from four reads. A read that has not returned
 * leaves its columns unknown rather than zero: a missing run page is not
 * "never ran".
 */
export function buildWorkflowRows(input: {
  workflows: ListWorkflowsResult | undefined;
  runs: ListRunsResult | undefined;
  parked: ListItemsResult | undefined;
  needsYou: ListItemsResult | undefined;
  runsFailed?: boolean;
}): WorkflowListRow[] {
  const newestRun = new Map<string, RunView>();
  const newestLiveRun = new Map<string, RunView>();
  for (const run of input.runs?.runs ?? []) {
    if (!newestRun.has(run.workflowId)) newestRun.set(run.workflowId, run);
    if (run.mode === "live" && !newestLiveRun.has(run.workflowId)) {
      newestLiveRun.set(run.workflowId, run);
    }
  }
  const parked = countByWorkflow(input.parked);
  const needsYou = countByWorkflow(input.needsYou);

  const rows = (input.workflows?.workflows ?? []).map(
    (workflow, index): WorkflowListRow & { index: number } => {
      const run = newestRun.get(workflow.id) ?? null;
      const lastRun: RunKnowledge = run
        ? { known: true, run }
        : !input.runs
          ? { known: false, why: input.runsFailed ? "failed" : "pending" }
          : input.runs.hasMore
            ? { known: false, why: "older" }
            : { known: true, run: null };
      const needs = needsYou.get(workflow.id) ?? 0;
      const attention: WorkflowListRow["attention"] =
        newestLiveRun.get(workflow.id)?.status === "failed"
          ? "failed"
          : workflow.job.pausedReason
            ? "paused"
            : needs > 0
              ? "needs_you"
              : null;
      return {
        index,
        workflow,
        schedule: describeCron(workflow.job.schedule),
        lastRun,
        itemsKnown: Boolean(input.parked && input.needsYou),
        parked: {
          count: parked.get(workflow.id) ?? 0,
          atLeast: input.parked?.hasMore === true,
        },
        needsYou: { count: needs, atLeast: input.needsYou?.hasMore === true },
        attention,
      };
    },
  );

  const rank = { failed: 0, paused: 1, needs_you: 2 } as const;
  return rows
    .sort((a, b) => {
      const left = a.attention ? rank[a.attention] : 3;
      const right = b.attention ? rank[b.attention] : 3;
      return left - right || a.index - b.index;
    })
    .map(({ index: _index, ...row }) => row);
}

/** "5" or "100+" for a count that may be a floor. */
export function formatItemCount({ count, atLeast }: ItemCount): string {
  return atLeast ? `${count}+` : String(count);
}

export function scheduleLabel(
  schedule: ScheduleSummary | null,
  canvas: WorkflowCanvasStrings,
  ws: WorkflowStrings,
): string | null {
  if (!schedule) return null;
  const s = canvas.summary;
  switch (schedule.kind) {
    case "minutes":
      return s.everyMinutes(schedule.minutes);
    case "hours":
      return ws.list.everyHours(schedule.hours);
    case "hourly":
      return s.everyHour;
    case "daily":
      return s.dailyAt(schedule.time);
    case "weekdays":
      return s.weekdaysAt(schedule.time);
    case "weekly":
      return s.weeklyAt(
        canvas.weekday[schedule.day] ?? String(schedule.day),
        schedule.time,
      );
    case "custom":
      return schedule.cron;
  }
}

/** Who started a run, for a label: nobody to name when the schedule did. */
export function runStarter(startedBy: string): string | null {
  return startedBy === SCHEDULE_STARTER ? null : startedBy;
}

/** True while some run in view is still going, so the list keeps refreshing. */
export function anyRunInFlight(runs: ListRunsResult | undefined): boolean {
  return runs?.runs.some((run) => run.status === "running") === true;
}

/** The list once a workflow is gone from it. */
export function withoutWorkflow(
  result: ListWorkflowsResult,
  workflowId: string,
): ListWorkflowsResult {
  return {
    ...result,
    workflows: result.workflows.filter(
      (workflow) => workflow.id !== workflowId,
    ),
  };
}

/**
 * How many items made a delete refuse, or null when it failed for another
 * reason (or did not say how many, which the message still does).
 */
export function parkedRefusal(failure: ActionFailure): ItemCount | null {
  if (failure.errorCode !== "parked_items_exist") return null;
  const { parkedItems, atLeast } = failure.details;
  if (typeof parkedItems !== "number" || !Number.isFinite(parkedItems)) {
    return null;
  }
  return { count: parkedItems, atLeast: atLeast === true };
}
