import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";

import { createWorkflowCanvasStrings } from "../workflow-canvas/strings";
import {
  anyRunInFlight,
  buildWorkflowRows,
  formatItemCount,
  parkedRefusal,
  runStarter,
  scheduleLabel as scheduleLabelOf,
  withoutWorkflow,
} from "./workflow-list-model";
import { createWorkflowStrings } from "./workflow-strings";
import type {
  ListItemsResult,
  ListRunsResult,
  ListWorkflowsResult,
  RunView,
  WorkflowItemRow,
  WorkflowSummaryRow,
} from "./workflow-types";

const t = createEnglishTranslator();
const scheduleLabel = (schedule: Parameters<typeof scheduleLabelOf>[0]) =>
  scheduleLabelOf(
    schedule,
    createWorkflowCanvasStrings(t),
    createWorkflowStrings(t),
  );

function workflow(
  id: string,
  job: Partial<WorkflowSummaryRow["job"]> = {},
): WorkflowSummaryRow {
  return {
    id,
    automationId: `job-${id}`,
    name: `Workflow ${id}`,
    version: 3,
    enabled: true,
    lastCleanDryRunVersion: 3,
    dryRunCurrent: true,
    lastTriggerAt: null,
    ownerEmail: "owner@example.com",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    job: {
      exists: true,
      enabled: true,
      schedule: "*/5 * * * *",
      timezone: null,
      runner: "workflow",
      lastStatus: null,
      lastRun: null,
      nextRun: null,
      lastError: null,
      lastErrorCode: null,
      consecutiveFailures: 0,
      pausedReason: null,
      pausedAt: null,
      drift: [],
      ...job,
    },
  };
}

function run(
  workflowId: string,
  fields: Partial<RunView> & { id: string },
): RunView {
  return {
    workflowId,
    workflowName: null,
    graphVersion: 3,
    mode: "live",
    status: "succeeded",
    triggerKind: "schedule",
    startedBy: "schedule",
    tickKey: "2026-10-18T12:00:00.000Z",
    startedAt: "2026-10-18T12:00:00.000Z",
    finishedAt: "2026-10-18T12:00:02.000Z",
    durationMs: 2000,
    counts: {},
    error: null,
    historyRowId: null,
    ...fields,
  };
}

function item(workflowId: string, itemId: string): WorkflowItemRow {
  return { workflowId, itemId } as WorkflowItemRow;
}

const workflows = (...rows: WorkflowSummaryRow[]): ListWorkflowsResult => ({
  workflows: rows,
  hasMore: false,
});
const runs = (list: RunView[], hasMore = false): ListRunsResult => ({
  runs: list,
  hasMore,
  nextCursor: null,
});
const items = (list: WorkflowItemRow[], hasMore = false): ListItemsResult => ({
  items: list,
  hasMore,
  nextCursor: null,
});

describe("buildWorkflowRows", () => {
  it("joins the newest run and the item counts to each workflow", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a"), workflow("b")),
      runs: runs([
        run("a", { id: "r2" }),
        run("a", { id: "r1" }),
        run("b", { id: "r3", status: "running" }),
      ]),
      parked: items([item("a", "i1"), item("a", "i2"), item("b", "i3")]),
      needsYou: items([item("b", "i3")]),
    });
    const a = rows.find((row) => row.workflow.id === "a");
    const b = rows.find((row) => row.workflow.id === "b");
    expect(a?.lastRun).toMatchObject({ known: true, run: { id: "r2" } });
    expect(a?.parked).toEqual({ count: 2, atLeast: false });
    expect(a?.needsYou.count).toBe(0);
    expect(b?.lastRun).toMatchObject({ known: true, run: { id: "r3" } });
    expect(b?.needsYou.count).toBe(1);
  });

  it("says no run exists only when every run was read", () => {
    const withNone = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([]),
      parked: items([]),
      needsYou: items([]),
    });
    expect(withNone[0]?.lastRun).toEqual({ known: true, run: null });

    const truncated = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([run("z", { id: "r9" })], true),
      parked: items([]),
      needsYou: items([]),
    });
    expect(truncated[0]?.lastRun).toEqual({ known: false, why: "older" });
  });

  it("does not call a run unknown-never while the runs have not loaded", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: undefined,
      parked: undefined,
      needsYou: undefined,
    });
    expect(rows[0]?.lastRun).toEqual({ known: false, why: "pending" });
    expect(rows[0]?.itemsKnown).toBe(false);
  });

  it("says a failed runs read failed rather than that nothing ran", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: undefined,
      runsFailed: true,
      parked: items([]),
      needsYou: items([]),
    });
    expect(rows[0]?.lastRun).toEqual({ known: false, why: "failed" });
    expect(rows[0]?.itemsKnown).toBe(true);
  });

  it("marks a count as a floor when its page was full", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([]),
      parked: items([item("a", "i1")], true),
      needsYou: items([]),
    });
    expect(rows[0]?.parked).toEqual({ count: 1, atLeast: true });
  });

  it("floats a failing workflow, then a paused one, then one that needs a person", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(
        workflow("fine"),
        workflow("needs"),
        workflow("paused", { pausedReason: "too many failures" }),
        workflow("failed"),
      ),
      runs: runs([
        run("failed", { id: "r1", status: "failed" }),
        run("fine", { id: "r2" }),
      ]),
      parked: items([]),
      needsYou: items([item("needs", "i1")]),
    });
    expect(rows.map((row) => [row.workflow.id, row.attention])).toEqual([
      ["failed", "failed"],
      ["paused", "paused"],
      ["needs", "needs_you"],
      ["fine", null],
    ]);
  });

  it("does not call a workflow failing because a test run failed", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([
        run("a", { id: "r2", mode: "dry", status: "failed" }),
        run("a", { id: "r1" }),
      ]),
      parked: items([]),
      needsYou: items([]),
    });
    expect(rows[0]?.attention).toBeNull();
    expect(rows[0]?.lastRun).toMatchObject({ run: { id: "r2" } });
  });

  it("keeps the server's order among equals", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a"), workflow("b"), workflow("c")),
      runs: runs([]),
      parked: items([]),
      needsYou: items([]),
    });
    expect(rows.map((row) => row.workflow.id)).toEqual(["a", "b", "c"]);
  });

  it("reads the schedule from the job's cron", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(
        workflow("a"),
        workflow("b", { schedule: null, exists: false }),
      ),
      runs: runs([]),
      parked: items([]),
      needsYou: items([]),
    });
    expect(rows[0]?.schedule).toEqual({ kind: "minutes", minutes: 5 });
    expect(rows[1]?.schedule).toBeNull();
  });
});

describe("formatItemCount", () => {
  it("adds a plus for a floor", () => {
    expect(formatItemCount({ count: 4, atLeast: false })).toBe("4");
    expect(formatItemCount({ count: 100, atLeast: true })).toBe("100+");
  });
});

describe("scheduleLabel", () => {
  it("words each schedule kind", () => {
    expect(scheduleLabel({ kind: "minutes", minutes: 5 })).toBe(
      "Every 5 minutes",
    );
    expect(scheduleLabel({ kind: "hourly" })).toBe("Every hour");
    expect(scheduleLabel({ kind: "hours", hours: 6 })).toBe("Every 6 hours");
    expect(scheduleLabel({ kind: "daily", time: "08:00" })).toBe(
      "Daily at 08:00",
    );
    expect(scheduleLabel({ kind: "weekdays", time: "09:30" })).toBe(
      "Weekdays at 09:30",
    );
    expect(scheduleLabel({ kind: "weekly", day: 1, time: "07:00" })).toBe(
      "Mon at 07:00",
    );
    expect(scheduleLabel({ kind: "custom", cron: "0 8 1 * *" })).toBe(
      "0 8 1 * *",
    );
    expect(scheduleLabel(null)).toBeNull();
  });
});

describe("anyRunInFlight", () => {
  it("is true only while a run is running", () => {
    expect(anyRunInFlight(undefined)).toBe(false);
    expect(anyRunInFlight(runs([run("a", { id: "r1" })]))).toBe(false);
    expect(
      anyRunInFlight(runs([run("a", { id: "r1", status: "running" })])),
    ).toBe(true);
  });
});

describe("runStarter", () => {
  it("names a person and leaves the schedule unnamed", () => {
    expect(runStarter("schedule")).toBeNull();
    expect(runStarter("owner@example.com")).toBe("owner@example.com");
  });
});

describe("withoutWorkflow", () => {
  it("drops one workflow and keeps the rest in order", () => {
    const list = workflows(workflow("a"), workflow("b"), workflow("c"));

    const next = withoutWorkflow(list, "b");

    expect(next.workflows.map((row) => row.id)).toEqual(["a", "c"]);
    expect(list.workflows).toHaveLength(3);
  });
});

describe("parkedRefusal", () => {
  const failure = (errorCode: string | null, details = {}) => ({
    errorCode,
    status: 409,
    message: "refused",
    details,
  });

  it("reads the count the delete refused over, as a floor when it says so", () => {
    expect(
      parkedRefusal(failure("parked_items_exist", { parkedItems: 3 })),
    ).toEqual({ count: 3, atLeast: false });
    expect(
      parkedRefusal(
        failure("parked_items_exist", { parkedItems: 100, atLeast: true }),
      ),
    ).toEqual({ count: 100, atLeast: true });
  });

  it("is null for any other failure, or a refusal that carries no count", () => {
    expect(parkedRefusal(failure("workflow_not_found"))).toBeNull();
    expect(parkedRefusal(failure(null))).toBeNull();
    expect(parkedRefusal(failure("parked_items_exist"))).toBeNull();
    expect(
      parkedRefusal(failure("parked_items_exist", { parkedItems: "3" })),
    ).toBeNull();
  });
});
