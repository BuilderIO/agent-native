import type {
  JobRunnerContext,
  JobRunnerResult,
} from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { createCapturingTripwireSink } from "../tripwire/testing.js";
import {
  WorkflowStoreError,
  type RunRecord,
  type WorkflowRecord,
  type WorkflowStore,
} from "../workflow/adapter.js";
import type { TickResult } from "../workflow/engine/index.js";
import { buildGraph } from "../workflow/story-graphs.fixture.js";
import { createInMemoryWorkflowStore } from "../workflow/testing/in-memory-store.js";
import {
  createWorkflowJobRunner,
  type WorkflowJobRunnerDeps,
} from "./job-runner.js";

const SCOPE = { orgId: "org-1", factoryId: "support-triage" };
const OWNER = "creator@example.test";
const CLICKER = "teammate@example.test";
const JOB_NAME = "factories/support-triage/workflow-digest-1a2b3c4d";
const JOB_ID = "resource-job-1";
const SCHEDULED = "2026-10-19T12:15:00.000Z";

const graph = buildGraph({
  settings: { builderStuckAfterMinutes: 45 },
  nodes: [
    ["start", "trigger", { schedule: { every: "15m" } }],
    ["finish", "end", { outcome: "done" }],
  ],
  edges: [["start", "out", "finish"]],
});

let historyCount = 0;

function context(overrides: Partial<JobRunnerContext> = {}): JobRunnerContext {
  historyCount += 1;
  return {
    name: JOB_NAME,
    path: `jobs/${JOB_NAME}.md`,
    meta: { schedule: "*/15 * * * *", enabled: true, runner: "workflow" },
    ownerEmail: OWNER,
    orgId: SCOPE.orgId,
    historyId: `history-${historyCount}`,
    manual: false,
    scheduledFor: SCHEDULED,
    deadlineAt: Date.parse("2026-10-19T12:20:00.000Z"),
    hardDeadlineAt: Date.parse("2026-10-19T12:20:20.000Z"),
    signal: new AbortController().signal,
    assertCanContinue: async () => {},
    actionAutomation: { triggerId: JOB_ID, triggerName: JOB_NAME },
    ...overrides,
  } as JobRunnerContext;
}

const manual = (overrides: Partial<JobRunnerContext> = {}) =>
  context({ manual: true, scheduledFor: null, ...overrides });

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "wfr-1",
    workflowId: "wf-1",
    graphVersion: 1,
    mode: "live",
    tickKey: SCHEDULED,
    triggerKind: "schedule",
    startedBy: "schedule",
    status: "succeeded",
    startedAt: SCHEDULED,
    counts: {},
    ...overrides,
  };
}

const ran = (
  run: Partial<RunRecord> = {},
  clean = true,
): Extract<TickResult, { kind: "ran" }> => ({
  kind: "ran",
  run: runRecord(run),
  steps: [],
  clean,
  passes: { trigger: true, resumed: 0 },
});

let store: WorkflowStore;
let workflow: WorkflowRecord;
let runTick: ReturnType<typeof vi.fn>;
let createHost: ReturnType<typeof vi.fn>;
let log: Mock<(message: string) => void>;
let loadSampleItems: ReturnType<typeof vi.fn>;

async function seed(options: { enabled?: boolean } = {}) {
  workflow = await store.createWorkflow(SCOPE, {
    name: "Digest",
    graph,
    ownerEmail: OWNER,
    automationId: JOB_ID,
  });
  if (options.enabled !== false) {
    await store.recordCleanDryRun(SCOPE, {
      workflowId: workflow.id,
      version: 1,
    });
    await store.setWorkflowEnabled(SCOPE, workflow.id, true);
  }
}

let tripwires: ReturnType<typeof createCapturingTripwireSink>;
let flush: Mock<() => Promise<void>>;

// A minute after the tick's due instant, so a healthy tick is on time.
function runner(overrides: Partial<WorkflowJobRunnerDeps> = {}) {
  return createWorkflowJobRunner({
    store: () => store,
    runTick: runTick as never,
    createHost: createHost as never,
    loadSampleItems: loadSampleItems as never,
    log,
    now: () => Date.parse(SCHEDULED) + 60_000,
    flush,
    hostDeps: { tripwire: tripwires.sink },
    ...overrides,
  });
}

async function failureOf(
  promise: Promise<unknown>,
): Promise<Error & { errorCode?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { errorCode?: string };
  }
  throw new Error("Expected the runner to throw.");
}

beforeEach(() => {
  store = createInMemoryWorkflowStore();
  runTick = vi.fn(async () => ran());
  createHost = vi.fn(() => ({ marker: "host" }));
  loadSampleItems = vi.fn(async () => []);
  log = vi.fn<(message: string) => void>();
  tripwires = createCapturingTripwireSink();
  flush = vi.fn(async () => {});
});

describe("the workflow job runner", () => {
  describe("what it tells core", () => {
    beforeEach(() => seed());

    it.each<[string, TickResult, JobRunnerResult]>([
      [
        "a succeeded run is a success carrying the workflow's run id",
        ran({ id: "wfr-9" }),
        { status: "success", runId: "wfr-9" },
      ],
      [
        "nothing due is a skip with the engine's reason",
        { kind: "nothing_due", message: "Nothing due: wait." },
        { status: "skipped", reason: "Nothing due: wait." },
      ],
      [
        "a tick key that already has a run is a skip naming that run",
        { kind: "duplicate_tick", run: runRecord({ id: "wfr-3" }) },
        {
          status: "skipped",
          reason: `Tick ${SCHEDULED} already has run wfr-3.`,
          runId: "wfr-3",
        },
      ],
    ])("%s", async (_name, tick, expected) => {
      runTick.mockResolvedValue(tick);
      expect(await runner()(context())).toEqual(expected);
    });

    it("counts a run that stopped at the soft deadline as a success, and says it paused", async () => {
      runTick.mockResolvedValue(
        ran({
          id: "wfr-4",
          status: "paused",
          error: {
            code: "budget_paused",
            message: "The soft deadline passed.",
          },
        }),
      );

      expect(await runner()(context())).toEqual({
        status: "success",
        runId: "wfr-4",
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("run_paused: workflow run wfr-4"),
      );
    });

    it("throws a failed run with its code, so core records the failure", async () => {
      runTick.mockResolvedValue(
        ran({
          id: "wfr-5",
          status: "failed",
          error: { code: "graph_invalid", message: "No trigger." },
        }),
      );

      const failure = await failureOf(runner()(context()));

      expect(failure).toMatchObject({
        errorCode: "graph_invalid",
        details: { runId: "wfr-5" },
      });
      expect(failure.message).toContain("No trigger.");
    });

    it("throws a run that could not start, with the engine's reason as the code", async () => {
      runTick.mockResolvedValue({
        kind: "not_runnable",
        reason: "version_not_current",
        message: "A live run uses the current version.",
      });

      expect(await failureOf(runner()(context()))).toMatchObject({
        errorCode: "version_not_current",
      });
    });

    it("gives an engine crash a code, and keeps one it already has", async () => {
      runTick.mockRejectedValue(new Error("connection reset"));
      const wrapped = await failureOf(runner()(context()));
      expect(wrapped).toMatchObject({ errorCode: "engine_error" });
      expect(wrapped.message).toContain("connection reset");
      expect((wrapped as { cause?: unknown }).cause).toBeInstanceOf(Error);

      const typed = Object.assign(new Error("typed"), { errorCode: "x_code" });
      runTick.mockRejectedValue(typed);
      expect(await failureOf(runner()(context()))).toBe(typed);
    });
  });

  describe("what core makes of a failed run's code", () => {
    beforeEach(() => seed());

    type Call = "operation" | "inbox";

    /** A host whose calls fail the way the executor and the inbox report, then a run failed with the code and message the engine kept. */
    function failedRun(
      call: Call,
      failure: { code: string; message: string; retryable: boolean },
      run: { code: string; message?: string } = failure,
    ) {
      const result = { ok: false, sideEffect: "none", ...failure };
      createHost.mockReturnValue({
        operations: { execute: vi.fn(async () => result) },
        inbox: { take: vi.fn(async () => result) },
      });
      runTick.mockImplementation(async ({ host }) => {
        if (call === "operation") await host.operations.execute({});
        else await host.inbox.take({});
        return ran(
          {
            id: "wfr-7",
            status: "failed",
            error: {
              code: run.code as never,
              message: run.message ?? failure.message,
            },
          },
          false,
        );
      });
    }

    const OUTAGE = "HubSpot failed while running hubspot.newLeads (HTTP 503).";

    it("gives a provider outage core's transient code, and keeps the workflow's own code in the details", async () => {
      failedRun("operation", {
        code: "lookup_failed",
        message: `${OUTAGE} (provider_unavailable)`,
        retryable: true,
      });

      const failure = await failureOf(runner()(context()));

      expect(failure).toMatchObject({
        errorCode: "provider_network_error",
        details: { runId: "wfr-7", workflowCode: "lookup_failed" },
      });
      expect(failure.message).toContain(OUTAGE);
    });

    it("does the same for an inbox poller the inbox called retryable", async () => {
      failedRun("inbox", {
        code: "provider_error",
        message: "poller_failed: poll-slack-channel failed: timed out",
        retryable: true,
      });

      expect(await failureOf(runner()(context()))).toMatchObject({
        errorCode: "provider_network_error",
        details: { workflowCode: "provider_error" },
      });
    });

    it("keeps a failure the executor called final under its own code, so a person sees it", async () => {
      failedRun("operation", {
        code: "provider_error",
        message: "HubSpot rejected hubspot.newLeads (HTTP 400).",
        retryable: false,
      });

      expect(await failureOf(runner()(context()))).toMatchObject({
        errorCode: "provider_error",
        details: { runId: "wfr-7" },
      });
    });

    it.each(["credential_missing", "graph_invalid", "operation_not_allowed"])(
      "never softens %s, even when a retryable call failed earlier in the run",
      async (code) => {
        failedRun(
          "operation",
          {
            code: "lookup_failed",
            message: `${OUTAGE} (provider_unavailable)`,
            retryable: true,
          },
          { code, message: "The graph changed." },
        );

        expect(await failureOf(runner()(context()))).toMatchObject({
          errorCode: code,
        });
      },
    );

    it("tells a retried failure that recovered from a different failure with the same code", async () => {
      failedRun(
        "operation",
        {
          code: "lookup_failed",
          message: `${OUTAGE} (provider_unavailable)`,
          retryable: true,
        },
        {
          code: "lookup_failed",
          message: "hubspot.newLeads returned a result Factory cannot use.",
        },
      );

      expect(await failureOf(runner()(context()))).toMatchObject({
        errorCode: "lookup_failed",
      });
    });
  });

  describe("a scheduled tick", () => {
    beforeEach(() => seed());

    it("is a live run keyed by the instant it was scheduled for", async () => {
      await runner()(context());

      expect(runTick).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: SCOPE,
          workflowId: workflow.id,
          tickKey: SCHEDULED,
          mode: "live",
          triggerKind: "schedule",
          startedBy: "schedule",
          scheduledFor: SCHEDULED,
        }),
      );
      expect(runTick.mock.calls[0]?.[0]).not.toHaveProperty("sampleItems");
    });

    it("refuses a scheduled tick that does not say which tick it is", async () => {
      expect(
        await failureOf(runner()(context({ scheduledFor: null }))),
      ).toMatchObject({ errorCode: "scheduled_for_required" });
      expect(runTick).not.toHaveBeenCalled();
    });

    it("passes the hard-deadline signal and the soft deadline through to the host and the engine", async () => {
      const controller = new AbortController();
      const ctx = context({
        signal: controller.signal,
        deadlineAt: 1_900_000_000_000,
      });

      await runner()(ctx);

      expect(runTick.mock.calls[0]?.[0].signal).toBe(controller.signal);
      expect(createHost).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: SCOPE,
          ownerEmail: OWNER,
          workflow: expect.objectContaining({ id: workflow.id }),
          automation: ctx.actionAutomation,
          runId: ctx.historyId,
          historyRowId: ctx.historyId,
          mode: "live",
          signal: controller.signal,
          deadlineAt: 1_900_000_000_000,
          settings: expect.objectContaining({ builderStuckAfterMinutes: 45 }),
        }),
      );
      expect(runTick.mock.calls[0]?.[0].host).toMatchObject({ marker: "host" });
    });

    it("stops before the tick when the scheduler says this worker no longer owns it", async () => {
      const assertCanContinue = vi.fn(async () => {
        throw new Error("lost the lease");
      });

      await failureOf(runner()(context({ assertCanContinue })));

      expect(runTick).not.toHaveBeenCalled();
    });
  });

  describe("a live run needs the workflow switched on", () => {
    beforeEach(() => seed({ enabled: false }));

    it("refuses a scheduled tick and a plain Run now, and never builds a host or calls the engine", async () => {
      for (const ctx of [context(), manual()]) {
        expect(await failureOf(runner()(ctx))).toMatchObject({
          errorCode: "workflow_disabled",
        });
      }
      expect(createHost).not.toHaveBeenCalled();
      expect(runTick).not.toHaveBeenCalled();
    });

    it("refuses a live request, and the request is spent", async () => {
      const request = await store.createRunRequest(SCOPE, {
        workflowId: workflow.id,
        mode: "live",
        requestedBy: CLICKER,
      });

      expect(await failureOf(runner()(manual()))).toMatchObject({
        errorCode: "workflow_disabled",
      });

      expect(
        (await store.getRunRequest(SCOPE, request.id))?.claimedAt,
      ).not.toBe(null);
      expect(runTick).not.toHaveBeenCalled();
    });

    it("still runs a dry run and a test run", async () => {
      await store.createRunRequest(SCOPE, {
        workflowId: workflow.id,
        mode: "dry",
        requestedBy: CLICKER,
      });
      await store.createRunRequest(SCOPE, {
        workflowId: workflow.id,
        mode: "test",
        testNodeId: "finish",
        requestedBy: CLICKER,
      });

      await runner()(manual());
      await runner()(manual());

      expect(runTick.mock.calls.map((call) => call[0].mode)).toEqual([
        "dry",
        "test",
      ]);
    });
  });

  describe("a manual tick", () => {
    beforeEach(() => seed());

    it("runs what the click asked for, as the person who clicked", async () => {
      const request = await store.createRunRequest(SCOPE, {
        workflowId: workflow.id,
        mode: "test",
        testNodeId: "finish",
        sampleItemIds: ["item-1"],
        requestedBy: CLICKER,
      });
      const sample = { id: "item-1", item: { title: "One" } };
      loadSampleItems.mockResolvedValue([sample]);

      await runner()(manual());

      expect(loadSampleItems).toHaveBeenCalledWith(SCOPE, ["item-1"]);
      expect(runTick).toHaveBeenCalledWith(
        expect.objectContaining({
          tickKey: `manual:${request.id}`,
          mode: "test",
          triggerKind: "test",
          startedBy: CLICKER,
          testNodeId: "finish",
          sampleItems: [sample],
        }),
      );
      expect(runTick.mock.calls[0]?.[0]).not.toHaveProperty("scheduledFor");
    });

    it.each([
      ["dry", "dry_run"],
      ["live", "manual"],
    ] as const)(
      "records a %s request as a %s run",
      async (mode, triggerKind) => {
        await store.createRunRequest(SCOPE, {
          workflowId: workflow.id,
          mode,
          requestedBy: CLICKER,
        });

        await runner()(manual());

        expect(runTick.mock.calls[0]?.[0]).toMatchObject({
          mode,
          triggerKind,
          startedBy: CLICKER,
        });
      },
    );

    it("is a plain live Run now when nobody asked for anything, started by the job's owner and keyed by its history row", async () => {
      const ctx = manual();

      await runner()(ctx);

      expect(runTick.mock.calls[0]?.[0]).toMatchObject({
        tickKey: `manual:${ctx.historyId}`,
        mode: "live",
        triggerKind: "manual",
        startedBy: OWNER,
      });
    });

    it("lets one of two ticks have a request, and the other runs plain", async () => {
      await store.createRunRequest(SCOPE, {
        workflowId: workflow.id,
        mode: "dry",
        requestedBy: CLICKER,
      });

      await Promise.all([runner()(manual()), runner()(manual())]);

      expect(runTick.mock.calls.map((call) => call[0].mode).sort()).toEqual([
        "dry",
        "live",
      ]);
    });

    it("fails a tick whose request expired, instead of running it live", async () => {
      const clock = { now: Date.parse("2026-10-19T12:00:00.000Z") };
      store = createInMemoryWorkflowStore({
        clock: () => new Date(clock.now),
      });
      await seed();
      const stale = await store.createRunRequest(SCOPE, {
        workflowId: workflow.id,
        mode: "dry",
        requestedBy: CLICKER,
      });
      clock.now += 11 * 60_000;

      const failure = await failureOf(runner()(manual()));

      expect(failure).toMatchObject({
        errorCode: "run_request_expired",
      });
      expect(failure.message).toContain(CLICKER);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(`run_request_expired: dry request ${stale.id}`),
      );
      expect(runTick).not.toHaveBeenCalled();
    });

    it("fails when a pinned sample item is missing", async () => {
      await store.createRunRequest(SCOPE, {
        workflowId: workflow.id,
        mode: "test",
        testNodeId: "finish",
        sampleItemIds: ["gone"],
        requestedBy: CLICKER,
      });
      const { WorkflowRunFailure } = await import("./run-requests.js");
      loadSampleItems.mockRejectedValue(
        new WorkflowRunFailure("sample_item_not_found", "No such item."),
      );

      expect(await failureOf(runner()(manual()))).toMatchObject({
        errorCode: "sample_item_not_found",
      });
      expect(runTick).not.toHaveBeenCalled();
    });
  });

  describe("a clean dry run of the current version", () => {
    let dryWorkflow: WorkflowRecord;
    let recordCleanDryRun: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      await seed({ enabled: false });
      dryWorkflow = workflow;
      recordCleanDryRun = vi.fn(store.recordCleanDryRun.bind(store));
      store = { ...store, recordCleanDryRun } as WorkflowStore;
    });

    const request = (mode: "dry" | "test" | "live") =>
      store.createRunRequest(SCOPE, {
        workflowId: dryWorkflow.id,
        mode,
        ...(mode === "test" ? { testNodeId: "finish" } : {}),
        requestedBy: CLICKER,
      });

    it("is recorded against the version it ran", async () => {
      await request("dry");
      runTick.mockResolvedValue(
        ran({ mode: "dry", graphVersion: 1, triggerKind: "dry_run" }, true),
      );

      await runner()(manual());

      expect(recordCleanDryRun).toHaveBeenCalledWith(SCOPE, {
        workflowId: dryWorkflow.id,
        version: 1,
      });
      expect(
        (await store.getWorkflow(SCOPE, dryWorkflow.id))
          ?.lastCleanDryRunVersion,
      ).toBe(1);
    });

    it("is not recorded when the engine says the dry run was not clean", async () => {
      await request("dry");
      runTick.mockResolvedValue(ran({ mode: "dry" }, false));

      expect(await runner()(manual())).toMatchObject({ status: "success" });

      expect(recordCleanDryRun).not.toHaveBeenCalled();
    });

    it("is not recorded for a test run, a live run, or a dry run that failed", async () => {
      await request("test");
      runTick.mockResolvedValue(ran({ mode: "test" }, true));
      await runner()(manual());

      await store.setWorkflowEnabled(SCOPE, dryWorkflow.id, false);
      await store.recordCleanDryRun(SCOPE, {
        workflowId: dryWorkflow.id,
        version: 1,
      });
      await store.setWorkflowEnabled(SCOPE, dryWorkflow.id, true);
      recordCleanDryRun.mockClear();
      await request("live");
      runTick.mockResolvedValue(ran({ mode: "live" }, true));
      await runner()(manual());

      await request("dry");
      runTick.mockResolvedValue(
        ran(
          {
            mode: "dry",
            status: "failed",
            error: { code: "provider_error", message: "down" },
          },
          false,
        ),
      );
      await failureOf(runner()(manual()));

      expect(recordCleanDryRun).not.toHaveBeenCalled();
    });

    it("is logged, not thrown, when a save moved the workflow past that version meanwhile", async () => {
      await request("dry");
      runTick.mockImplementation(async () => {
        await store.saveWorkflowGraph(SCOPE, {
          workflowId: dryWorkflow.id,
          expectedVersion: 1,
          graph,
          source: "save",
          summary: "edit",
          createdBy: OWNER,
        });
        return ran({ mode: "dry", graphVersion: 1 }, true);
      });

      expect(await runner()(manual())).toMatchObject({ status: "success" });

      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("dry_run_not_recorded"),
      );
      expect(
        (await store.getWorkflow(SCOPE, dryWorkflow.id))
          ?.lastCleanDryRunVersion,
      ).toBeNull();
    });

    it("does not hide a store failure while recording", async () => {
      await request("dry");
      runTick.mockResolvedValue(ran({ mode: "dry" }, true));
      recordCleanDryRun.mockRejectedValue(new Error("database is down"));

      expect((await failureOf(runner()(manual()))).message).toBe(
        "database is down",
      );
    });
  });

  describe("a workflow it cannot find or read", () => {
    it("fails with config_invalid when no saved workflow belongs to the job", async () => {
      const failure = await failureOf(runner()(context()));

      expect(failure).toMatchObject({
        errorCode: "config_invalid",
        details: { automationId: JOB_ID },
      });
      expect(createHost).not.toHaveBeenCalled();
      expect(runTick).not.toHaveBeenCalled();
    });

    it("fails with config_invalid for a job outside an organization or a factory folder", async () => {
      await seed();
      for (const ctx of [
        context({ orgId: undefined }),
        context({
          actionAutomation: { triggerId: JOB_ID, triggerName: "stray-job" },
        }),
      ]) {
        expect(await failureOf(runner()(ctx))).toMatchObject({
          errorCode: "config_invalid",
        });
      }
    });

    it("looks for the workflow in the job's own organization and factory", async () => {
      await seed();
      expect(
        await failureOf(runner()(context({ orgId: "org-other" }))),
      ).toMatchObject({ errorCode: "config_invalid" });
      expect(
        await failureOf(
          runner()(
            context({
              actionAutomation: {
                triggerId: JOB_ID,
                triggerName: "factories/other-factory/workflow-x",
              },
            }),
          ),
        ),
      ).toMatchObject({ errorCode: "config_invalid" });
    });

    it("reports a stored workflow that no longer parses as unreadable, never as missing", async () => {
      store = {
        ...createInMemoryWorkflowStore(),
        getWorkflowByAutomation: async () => {
          throw new WorkflowStoreError(
            "corrupt_record",
            "The graph no longer parses.",
          );
        },
      } as WorkflowStore;

      expect(await failureOf(runner()(context()))).toMatchObject({
        errorCode: "workflow_graph_unreadable",
      });
    });
  });
});

describe("the workflow job runner: what it reports when the scheduler misbehaves", () => {
  beforeEach(() => seed());

  describe("a tick that started late", () => {
    const startedAfter = (minutes: number) => ({
      now: () => Date.parse(SCHEDULED) + minutes * 60_000,
    });

    it("runs the tick anyway", async () => {
      const result = await runner(startedAfter(40))(context());

      expect(result).toEqual({ status: "success", runId: "wfr-1" });
      expect(runTick).toHaveBeenCalledTimes(1);
    });
  });

  describe("items that woke late", () => {
    const parked = (nodeId: string, dueAt: string, nextCheckAt?: string) => ({
      workflowId: "wf-1",
      graphVersion: 1,
      itemId: `item-${nodeId}`,
      parkedAtNode: nodeId,
      wake: { wait: "reply", dueAt, ...(nextCheckAt ? { nextCheckAt } : {}) },
      context: {},
      counters: {},
      updatedAt: SCHEDULED,
    });

    function hostListing(due: unknown[]) {
      const listDueParked = vi.fn(async () => due);
      createHost.mockImplementation(() => ({ store: { listDueParked } }));
      runTick.mockImplementation(async (input: any) => {
        await input.host.store.listDueParked(SCOPE, {
          workflowId: workflow.id,
          now: SCHEDULED,
          limit: 20,
        });
        return ran();
      });
      return listDueParked;
    }
    const minutesBefore = (minutes: number) =>
      new Date(Date.parse(SCHEDULED) - minutes * 60_000).toISOString();

    it("hands the engine the list as it came", async () => {
      const due = [
        parked("a", minutesBefore(31)),
        // Its deadline is hours away; its check was due fifty minutes ago.
        parked("b", minutesBefore(-120), minutesBefore(50)),
        parked("c", minutesBefore(20)),
      ];
      const listDueParked = hostListing(due);
      let handed: unknown;
      runTick.mockImplementation(async (input: any) => {
        handed = await input.host.store.listDueParked(SCOPE, {
          workflowId: workflow.id,
          now: SCHEDULED,
          limit: 20,
        });
        return ran();
      });

      await runner()(context());

      expect(handed).toBe(due);
      expect(listDueParked).toHaveBeenCalledTimes(1);
    });
  });
});
