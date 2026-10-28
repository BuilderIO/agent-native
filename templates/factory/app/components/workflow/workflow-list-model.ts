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

/** How many recent runs the run picker reads; the page watches the same read for a queued run. */
export const RECENT_RUNS = 25;

/**
 * The longest name the server keeps (`workflowNameSchema`, one line). A copy or
 * a rename is checked against it before the request, not after the refusal.
 */
export const WORKFLOW_NAME_MAX_LENGTH = 120;

/** A count of items that may be a floor: the page that held them was full. */
export interface ItemCount {
  count: number;
  atLeast: boolean;
}

type RunKnowledge =
  /** The newest run of this kind in the page of recent runs. */
  | { known: true; run: RunView }
  /** No run of this kind exists: every run was read and none is this workflow's. */
  | { known: true; run: null }
  | {
      known: false;
      /** `pending`: not read yet. `failed`: the read failed. `older`: the page of recent runs was full and holds none of this workflow's. */
      why: "pending" | "failed" | "older";
    };

export interface WorkflowListRow {
  workflow: WorkflowSummaryRow;
  schedule: ScheduleSummary | null;
  /** The newest run of any kind, test and dry runs included. */
  lastRun: RunKnowledge;
  /** The newest live run only: a failed test run does not make a workflow failing. */
  liveRun: RunKnowledge;
  /** False when either item read failed or has not returned: the counts below are then not zero, they are unknown. */
  itemsKnown: boolean;
  parked: ItemCount;
  needsYou: ItemCount;
  /** Why this row floats to the top: its newest live run failed, its job was paused, or people have to look. */
  attention: "failed" | "paused" | "needs_you" | null;
}

/**
 * What the page of recent runs says about one workflow's newest run of a kind.
 * A missing page is not "never ran", and a full page without this workflow
 * does not prove it has no run either.
 */
function knowRun(
  run: RunView | undefined,
  input: { runs: ListRunsResult | undefined; runsFailed?: boolean },
): RunKnowledge {
  if (run) return { known: true, run };
  if (!input.runs) {
    return { known: false, why: input.runsFailed ? "failed" : "pending" };
  }
  return input.runs.hasMore
    ? { known: false, why: "older" }
    : { known: true, run: null };
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
      const liveRun = knowRun(newestLiveRun.get(workflow.id), input);
      const needs = needsYou.get(workflow.id) ?? 0;
      const attention: WorkflowListRow["attention"] =
        liveRun.known && liveRun.run?.status === "failed"
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
        lastRun: knowRun(newestRun.get(workflow.id), input),
        liveRun,
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

/** One of the four summary figures: a count, or why it cannot be given yet. */
export type StatValue =
  | ({ state: "ready" } & ItemCount)
  | { state: "pending" }
  | { state: "failed" };

export interface WorkflowListStats {
  /** Workflows switched on, among the ones loaded. */
  on: ItemCount;
  /** Workflows loaded. */
  total: ItemCount;
  needsYou: StatValue;
  waiting: StatValue;
  failing: StatValue;
}

/**
 * The four figures over the loaded workflows. Each is a floor ("N+") while some
 * workflows are not loaded, since those could still add to it, and when the
 * page behind it was full. A figure is unknown while its read is pending or
 * failed. A failing count also stays a floor for any workflow whose live runs
 * are not on the page, since that workflow may be failing on a run nobody has
 * read.
 */
export function workflowListStats(input: {
  rows: readonly WorkflowListRow[];
  /** True while the list has workflows this view has not loaded. */
  unloadedWorkflows: boolean;
  itemsFailed: boolean;
}): WorkflowListStats {
  const { rows, unloadedWorkflows, itemsFailed } = input;
  const sumItems = (pick: (row: WorkflowListRow) => ItemCount): StatValue => {
    if (rows.some((row) => !row.itemsKnown)) {
      return { state: itemsFailed ? "failed" : "pending" };
    }
    return {
      state: "ready",
      count: rows.reduce((sum, row) => sum + pick(row).count, 0),
      atLeast: unloadedWorkflows || rows.some((row) => pick(row).atLeast),
    };
  };
  return {
    on: {
      count: rows.filter((row) => row.workflow.enabled).length,
      atLeast: unloadedWorkflows,
    },
    total: { count: rows.length, atLeast: unloadedWorkflows },
    needsYou: sumItems((row) => row.needsYou),
    waiting: sumItems((row) => row.parked),
    failing: failingStat(rows, unloadedWorkflows),
  };
}

function failingStat(
  rows: readonly WorkflowListRow[],
  unloadedWorkflows: boolean,
): StatValue {
  if (rows.some((row) => !row.liveRun.known && row.liveRun.why === "pending")) {
    return { state: "pending" };
  }
  if (rows.some((row) => !row.liveRun.known && row.liveRun.why === "failed")) {
    return { state: "failed" };
  }
  return {
    state: "ready",
    count: rows.filter(
      (row) => row.liveRun.known && row.liveRun.run?.status === "failed",
    ).length,
    atLeast: unloadedWorkflows || rows.some((row) => !row.liveRun.known),
  };
}

export type WorkflowSort = "attention" | "updated" | "name";
export type WorkflowStatusFilter = "all" | "on" | "off";

/** What the person picked on the list: the name to search for, the switch state, and the order. */
export interface WorkflowListChoices {
  /** Matched against the name, ignoring case and outer spaces; blank matches every name. */
  query: string;
  status: WorkflowStatusFilter;
  sort: WorkflowSort;
}

/**
 * The rows the list shows, filtered by name and switch state, then in the chosen
 * order. "attention" keeps the order `buildWorkflowRows` gave.
 */
export function arrangeWorkflowRows(
  rows: readonly WorkflowListRow[],
  choices: WorkflowListChoices,
  locale: string,
): WorkflowListRow[] {
  const needle = choices.query.trim().toLocaleLowerCase(locale);
  const shown = rows.filter((row) => {
    if (choices.status === "on" && !row.workflow.enabled) return false;
    if (choices.status === "off" && row.workflow.enabled) return false;
    return row.workflow.name.toLocaleLowerCase(locale).includes(needle);
  });
  if (choices.sort === "updated") return [...shown].sort(newestFirst);
  if (choices.sort === "name") {
    const collator = new Intl.Collator(locale, {
      numeric: true,
      sensitivity: "base",
    });
    return [...shown].sort((a, b) =>
      collator.compare(a.workflow.name, b.workflow.name),
    );
  }
  return shown;
}

function updatedMs(row: WorkflowListRow): number {
  const at = Date.parse(row.workflow.updatedAt);
  // A time that does not parse sorts last, not as an invented time.
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
}

function newestFirst(a: WorkflowListRow, b: WorkflowListRow): number {
  const left = updatedMs(a);
  const right = updatedMs(b);
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

/**
 * The name for a copy. `label` wraps the name, for example "{{name}} copy". The
 * name is cut, never the label, so the whole fits the name limit.
 */
export function copyWorkflowName(
  name: string,
  label: (name: string) => string,
): string {
  const whole = label(name);
  if (whole.length <= WORKFLOW_NAME_MAX_LENGTH) return whole;
  const room = WORKFLOW_NAME_MAX_LENGTH - label("").length;
  return label(cutName(name, room));
}

/** The first `max` characters, without splitting a surrogate pair into a broken character. */
function cutName(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  const splitsPair = code >= 0xd800 && code <= 0xdbff;
  return text.slice(0, splitsPair ? max - 1 : max);
}

/**
 * A rename is worth sending: the trimmed draft is one line within the limit,
 * and it differs from the name the workflow has now.
 */
export function canSaveRename(current: string, draft: string): boolean {
  const next = draft.trim();
  return (
    next.length > 0 &&
    next.length <= WORKFLOW_NAME_MAX_LENGTH &&
    !/[\r\n]/.test(next) &&
    next !== current
  );
}

/** The list once one workflow has a new name. */
export function withRenamedWorkflow(
  result: ListWorkflowsResult,
  workflowId: string,
  name: string,
): ListWorkflowsResult {
  return {
    ...result,
    workflows: result.workflows.map((workflow) =>
      workflow.id === workflowId ? { ...workflow, name } : workflow,
    ),
  };
}

/** The list once one workflow has a new switch state. */
export function withWorkflowEnabled(
  result: ListWorkflowsResult,
  workflowId: string,
  enabled: boolean,
): ListWorkflowsResult {
  return {
    ...result,
    workflows: result.workflows.map((workflow) =>
      workflow.id === workflowId ? { ...workflow, enabled } : workflow,
    ),
  };
}

/** A page after the first, as its own read reports it: the page, or that the read failed. */
export type WorkflowPageRead =
  | { state: "loaded"; page: ListWorkflowsResult }
  | { state: "failed" };

interface WorkflowPageChain {
  /** The pages the list shows, the first page included, in list order. */
  pages: ListWorkflowsResult[];
  /** The cursor of the page after the last one shown; null when there is no more. */
  nextCursor: string | null;
  /** The list says more follow but gives no cursor to reach them. */
  dangling: boolean;
  /** The cursors of the later pages in view: the loaded ones, and the one being read or that failed. */
  active: string[];
  /** The page the viewer asked for is still being read. */
  fetching: boolean;
  /** The page the viewer asked for failed; its own error shows, with a retry. */
  failed: boolean;
}

/**
 * The pages behind the list. The viewer asks for a number of pages after the
 * first, and each of those starts from the cursor the page before it names now.
 * So when an edit moves a boundary, the later pages move with it and the list
 * never skips a workflow. The chain stops at the first page still being read,
 * or at one that failed.
 */
export function chainWorkflowPages(input: {
  first: ListWorkflowsResult | undefined;
  /** How many pages after the first the viewer has asked for. */
  extra: number;
  reads: Readonly<Record<string, WorkflowPageRead | undefined>>;
}): WorkflowPageChain {
  if (!input.first) {
    return {
      pages: [],
      nextCursor: null,
      dangling: false,
      active: [],
      fetching: false,
      failed: false,
    };
  }
  const pages = [input.first];
  const active: string[] = [];
  let nextCursor = input.first.nextCursor;
  let fetching = false;
  let failed = false;
  for (let asked = 0; asked < input.extra && nextCursor !== null; asked += 1) {
    active.push(nextCursor);
    const read = input.reads[nextCursor];
    if (read?.state === "failed") {
      failed = true;
      break;
    }
    if (read?.state !== "loaded") {
      fetching = true;
      break;
    }
    pages.push(read.page);
    nextCursor = read.page.nextCursor;
  }
  const tail = pages[pages.length - 1];
  return {
    pages,
    nextCursor,
    dangling: tail.hasMore && tail.nextCursor === null,
    active,
    fetching,
    failed,
  };
}

/**
 * The workflows of several pages as one list, in page order. Two reads that
 * straddle an edit can both hold the same workflow, so the first copy wins. The
 * cursor and `hasMore` are the last page's.
 */
export function joinWorkflowPages(
  pages: readonly ListWorkflowsResult[],
): ListWorkflowsResult {
  const seen = new Set<string>();
  const workflows: WorkflowSummaryRow[] = [];
  for (const page of pages) {
    for (const workflow of page.workflows) {
      if (seen.has(workflow.id)) continue;
      seen.add(workflow.id);
      workflows.push(workflow);
    }
  }
  const last = pages[pages.length - 1];
  return {
    workflows,
    hasMore: last?.hasMore === true,
    nextCursor: last?.nextCursor ?? null,
  };
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

/**
 * Items a run that ended `succeeded` still left needing a person: failures
 * that ended for one. A failure parked for a retry (`retryParked`) is not one
 * yet and may recover on a later tick; an item routed to a person on purpose
 * is not a failure. Zero for a run in any other status.
 */
export function succeededItemFailures(
  run: Pick<RunView, "status" | "counts">,
): number {
  if (run.status !== "succeeded") return 0;
  const { itemFailures = 0, retryParked = 0, needsManual = 0 } = run.counts;
  return Math.min(Math.max(itemFailures - retryParked, 0), needsManual);
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
