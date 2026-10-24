import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";

import { createWorkflowCanvasStrings } from "../workflow-canvas/strings";
import {
  anyRunInFlight,
  arrangeWorkflowRows,
  buildWorkflowRows,
  canSaveRename,
  chainWorkflowPages,
  copyWorkflowName,
  formatItemCount,
  joinWorkflowPages,
  parkedRefusal,
  runStarter,
  scheduleLabel as scheduleLabelOf,
  withRenamedWorkflow,
  withoutWorkflow,
  withWorkflowEnabled,
  workflowListStats,
  type WorkflowListChoices,
  type WorkflowListRow,
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
  nextCursor: null,
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
    expect(rows[0]?.liveRun).toMatchObject({ known: true, run: { id: "r1" } });
  });

  it("keeps a live run unknown when a full page holds only test runs", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([run("a", { id: "r1", mode: "dry" })], true),
      parked: items([]),
      needsYou: items([]),
    });
    expect(rows[0]?.lastRun).toMatchObject({ known: true, run: { id: "r1" } });
    expect(rows[0]?.liveRun).toEqual({ known: false, why: "older" });
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

describe("workflowListStats", () => {
  const loaded = (...list: WorkflowSummaryRow[]) =>
    buildWorkflowRows({
      workflows: workflows(...list),
      runs: runs([]),
      parked: items([]),
      needsYou: items([]),
    });
  const stats = (
    rows: WorkflowListRow[],
    options: { unloadedWorkflows?: boolean; itemsFailed?: boolean } = {},
  ) =>
    workflowListStats({
      rows,
      unloadedWorkflows: options.unloadedWorkflows ?? false,
      itemsFailed: options.itemsFailed ?? false,
    });

  it("counts the workflows switched on out of the loaded total", () => {
    const result = stats(
      loaded(
        workflow("a"),
        { ...workflow("b"), enabled: false },
        workflow("c"),
      ),
    );
    expect(result.on).toEqual({ count: 2, atLeast: false });
    expect(result.total).toEqual({ count: 3, atLeast: false });
  });

  it("marks every figure as a floor while some workflows are not loaded", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([run("a", { id: "r1" })]),
      parked: items([item("a", "i1")]),
      needsYou: items([]),
    });
    const result = stats(rows, { unloadedWorkflows: true });
    expect(result.on).toEqual({ count: 1, atLeast: true });
    expect(result.total).toEqual({ count: 1, atLeast: true });
    expect(result.waiting).toEqual({ state: "ready", count: 1, atLeast: true });
    expect(result.needsYou).toEqual({
      state: "ready",
      count: 0,
      atLeast: true,
    });
    expect(result.failing).toEqual({
      state: "ready",
      count: 0,
      atLeast: true,
    });
  });

  it("shows exact figures once every workflow is loaded and no page was full", () => {
    const rows = loaded(workflow("a"));
    const result = stats(rows);
    expect(result.on).toEqual({ count: 1, atLeast: false });
    expect(result.total).toEqual({ count: 1, atLeast: false });
    expect(result.failing).toEqual({
      state: "ready",
      count: 0,
      atLeast: false,
    });
  });

  it("sums needs-you and waiting over the rows", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a"), workflow("b")),
      runs: runs([]),
      parked: items([item("a", "i1"), item("a", "i2")]),
      needsYou: items([item("b", "i3")]),
    });
    const result = stats(rows);
    expect(result.waiting).toEqual({
      state: "ready",
      count: 2,
      atLeast: false,
    });
    expect(result.needsYou).toEqual({
      state: "ready",
      count: 1,
      atLeast: false,
    });
  });

  it("marks waiting as a floor when the items page is full", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([]),
      parked: items([item("a", "i1")], true),
      needsYou: items([]),
    });
    expect(stats(rows).waiting).toEqual({
      state: "ready",
      count: 1,
      atLeast: true,
    });
  });

  it("is pending while the item reads are out, and failed once one fails", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: runs([]),
      parked: undefined,
      needsYou: undefined,
    });
    expect(stats(rows).needsYou).toEqual({ state: "pending" });
    expect(stats(rows, { itemsFailed: true }).waiting).toEqual({
      state: "failed",
    });
  });

  it("counts failing workflows exactly when every live run is on the page", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(workflow("failed"), workflow("fine")),
      runs: runs([
        run("failed", { id: "r1", status: "failed" }),
        run("fine", { id: "r2" }),
      ]),
      parked: items([]),
      needsYou: items([]),
    });
    expect(stats(rows).failing).toEqual({
      state: "ready",
      count: 1,
      atLeast: false,
    });
  });

  it("keeps the failing count a floor while a live run is off the page", () => {
    const rows = buildWorkflowRows({
      workflows: workflows(
        workflow("failed"),
        workflow("fine"),
        workflow("unseen"),
      ),
      runs: runs(
        [
          run("failed", { id: "r1", status: "failed" }),
          run("fine", { id: "r2" }),
        ],
        true,
      ),
      parked: items([]),
      needsYou: items([]),
    });
    expect(stats(rows).failing).toEqual({
      state: "ready",
      count: 1,
      atLeast: true,
    });
  });

  it("is pending until the runs read returns, and failed when it fails", () => {
    const pending = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: undefined,
      parked: items([]),
      needsYou: items([]),
    });
    const failed = buildWorkflowRows({
      workflows: workflows(workflow("a")),
      runs: undefined,
      runsFailed: true,
      parked: items([]),
      needsYou: items([]),
    });
    expect(stats(pending).failing).toEqual({ state: "pending" });
    expect(stats(failed).failing).toEqual({ state: "failed" });
  });
});

describe("arrangeWorkflowRows", () => {
  const loaded = (...list: WorkflowSummaryRow[]) =>
    buildWorkflowRows({
      workflows: workflows(...list),
      runs: runs([]),
      parked: items([]),
      needsYou: items([]),
    });
  const named = (
    id: string,
    name: string,
    fields: Partial<WorkflowSummaryRow> = {},
  ): WorkflowSummaryRow => ({ ...workflow(id), name, ...fields });
  const ids = (rows: WorkflowListRow[]) => rows.map((row) => row.workflow.id);
  const everything: WorkflowListChoices = {
    query: "",
    status: "all",
    sort: "attention",
  };

  it("filters by name, ignoring case and outer spaces", () => {
    const rows = loaded(
      named("a", "Daily digest"),
      named("b", "Weekly report"),
    );
    expect(
      ids(
        arrangeWorkflowRows(
          rows,
          { ...everything, query: "  DAILY " },
          "en-US",
        ),
      ),
    ).toEqual(["a"]);
    expect(
      ids(arrangeWorkflowRows(rows, { ...everything, query: "   " }, "en-US")),
    ).toEqual(["a", "b"]);
  });

  it("filters by switch state", () => {
    const rows = loaded(
      named("a", "Alpha"),
      named("b", "Beta", { enabled: false }),
    );
    expect(
      ids(arrangeWorkflowRows(rows, { ...everything, status: "on" }, "en-US")),
    ).toEqual(["a"]);
    expect(
      ids(arrangeWorkflowRows(rows, { ...everything, status: "off" }, "en-US")),
    ).toEqual(["b"]);
  });

  it("keeps the attention order by default and sorts by name when asked", () => {
    const rows = loaded(named("plain", "Alpha"), {
      ...workflow("paused", { pausedReason: "too many failures" }),
      name: "Zed",
    });
    expect(ids(arrangeWorkflowRows(rows, everything, "en-US"))).toEqual([
      "paused",
      "plain",
    ]);
    expect(
      ids(arrangeWorkflowRows(rows, { ...everything, sort: "name" }, "en-US")),
    ).toEqual(["plain", "paused"]);
  });

  it("sorts by last updated, newest first, and by name in natural order", () => {
    const rows = loaded(
      named("old", "Report 10", { updatedAt: "2026-10-01T00:00:00.000Z" }),
      named("new", "report 2", { updatedAt: "2026-10-18T00:00:00.000Z" }),
      named("mid", "Report 1", { updatedAt: "2026-10-10T00:00:00.000Z" }),
    );
    expect(
      ids(
        arrangeWorkflowRows(rows, { ...everything, sort: "updated" }, "en-US"),
      ),
    ).toEqual(["new", "mid", "old"]);
    expect(
      ids(arrangeWorkflowRows(rows, { ...everything, sort: "name" }, "en-US")),
    ).toEqual(["mid", "new", "old"]);
  });

  it("sorts a time that does not parse last", () => {
    const rows = loaded(
      named("bad", "A", { updatedAt: "not a time" }),
      named("good", "B", { updatedAt: "2026-10-18T00:00:00.000Z" }),
    );
    expect(
      ids(
        arrangeWorkflowRows(rows, { ...everything, sort: "updated" }, "en-US"),
      ),
    ).toEqual(["good", "bad"]);
  });
});

describe("copyWorkflowName", () => {
  const label = (name: string) => `${name} copy`;

  it("wraps the name in the label", () => {
    expect(copyWorkflowName("Daily digest", label)).toBe("Daily digest copy");
  });

  it("cuts the name, never the label, so the copy fits the name limit", () => {
    const copy = copyWorkflowName("x".repeat(120), label);
    expect(copy.length).toBe(120);
    expect(copy.endsWith(" copy")).toBe(true);
  });

  it("does not leave half of a surrogate pair at the cut", () => {
    const copy = copyWorkflowName("😀".repeat(60), label);
    expect(copy).toBe(`${"😀".repeat(57)} copy`);
  });
});

describe("canSaveRename", () => {
  it("accepts a changed name that is trimmed, one line and within the limit", () => {
    expect(canSaveRename("Daily digest", "  Weekly digest ")).toBe(true);
    expect(canSaveRename("Daily digest", "x".repeat(120))).toBe(true);
  });

  it("refuses a name that is unchanged, blank, too long or on two lines", () => {
    expect(canSaveRename("Daily digest", " Daily digest ")).toBe(false);
    expect(canSaveRename("Daily digest", "   ")).toBe(false);
    expect(canSaveRename("Daily digest", "x".repeat(121))).toBe(false);
    expect(canSaveRename("Daily digest", "one\ntwo")).toBe(false);
  });
});

describe("withRenamedWorkflow", () => {
  it("renames one workflow and leaves the list it came from as it was", () => {
    const list = workflows(workflow("a"), workflow("b"));

    const next = withRenamedWorkflow(list, "b", "Renamed");

    expect(next.workflows.map((row) => row.name)).toEqual([
      "Workflow a",
      "Renamed",
    ]);
    expect(list.workflows[1]?.name).toBe("Workflow b");
  });
});

describe("withWorkflowEnabled", () => {
  it("switches one workflow and leaves the others as they were", () => {
    const list = workflows(workflow("a"), workflow("b"));

    const next = withWorkflowEnabled(list, "b", false);

    expect(next.workflows.map((row) => row.enabled)).toEqual([true, false]);
    expect(list.workflows[1]?.enabled).toBe(true);
  });
});

describe("joinWorkflowPages", () => {
  const page = (
    ids: string[],
    fields: Partial<ListWorkflowsResult> = {},
  ): ListWorkflowsResult => ({
    workflows: ids.map((id) => workflow(id)),
    hasMore: false,
    nextCursor: null,
    ...fields,
  });

  it("keeps page order and takes the cursor and hasMore from the last page", () => {
    const joined = joinWorkflowPages([
      page(["a", "b"], { hasMore: true, nextCursor: "c1" }),
      page(["c"], { hasMore: true, nextCursor: "c2" }),
    ]);

    expect(joined.workflows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(joined).toMatchObject({ hasMore: true, nextCursor: "c2" });
  });

  it("keeps the first copy of a workflow that two reads both hold", () => {
    const joined = joinWorkflowPages([page(["a", "b"]), page(["b", "c"])]);

    expect(joined.workflows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("is an empty list with no cursor when there are no pages", () => {
    expect(joinWorkflowPages([])).toEqual({
      workflows: [],
      hasMore: false,
      nextCursor: null,
    });
  });
});

describe("chainWorkflowPages", () => {
  const page = (
    ids: string[],
    nextCursor: string | null,
  ): ListWorkflowsResult => ({
    workflows: ids.map((id) => workflow(id)),
    hasMore: nextCursor !== null,
    nextCursor,
  });
  const first = page(["a", "b"], "c1");

  it("shows only the first page until the viewer asks for more", () => {
    const chain = chainWorkflowPages({ first, extra: 0, reads: {} });

    expect(chain.pages).toEqual([first]);
    expect(chain.nextCursor).toBe("c1");
    expect(chain.active).toEqual([]);
    expect(chain.fetching).toBe(false);
  });

  it("is fetching while an asked-for page is read, and holds the list before it", () => {
    const chain = chainWorkflowPages({ first, extra: 1, reads: {} });

    expect(chain.pages).toEqual([first]);
    expect(chain.active).toEqual(["c1"]);
    expect(chain.fetching).toBe(true);
    expect(chain.failed).toBe(false);
  });

  it("appends a read page and moves on to the cursor it names", () => {
    const second = page(["c"], "c2");

    const chain = chainWorkflowPages({
      first,
      extra: 1,
      reads: { c1: { state: "loaded", page: second } },
    });

    expect(chain.pages).toEqual([first, second]);
    expect(chain.nextCursor).toBe("c2");
    expect(chain.active).toEqual(["c1"]);
    expect(chain.fetching).toBe(false);
  });

  it("reports a page whose read failed, and does not read past it", () => {
    const chain = chainWorkflowPages({
      first,
      extra: 2,
      reads: { c1: { state: "failed" } },
    });

    expect(chain.pages).toEqual([first]);
    expect(chain.active).toEqual(["c1"]);
    expect(chain.failed).toBe(true);
    expect(chain.fetching).toBe(false);
  });

  it("follows a boundary that moved, so no workflow is skipped", () => {
    // The first page now ends at c9, so the page after it starts there, not at
    // the c1 that an older read of it named.
    const moved = page(["a", "b"], "c9");

    const chain = chainWorkflowPages({
      first: moved,
      extra: 1,
      reads: { c1: { state: "loaded", page: page(["x"], null) } },
    });

    expect(chain.active).toEqual(["c9"]);
    expect(chain.fetching).toBe(true);
    expect(chain.pages).toEqual([moved]);
  });

  it("names the list dangling when more follow but no cursor says where", () => {
    const chain = chainWorkflowPages({
      first: { workflows: [workflow("a")], hasMore: true, nextCursor: null },
      extra: 0,
      reads: {},
    });

    expect(chain.dangling).toBe(true);
    expect(chain.nextCursor).toBeNull();
  });

  it("has no pages before the first one loads", () => {
    const chain = chainWorkflowPages({ first: undefined, extra: 1, reads: {} });

    expect(chain).toMatchObject({ pages: [], nextCursor: null, active: [] });
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
