import { createRequire } from "node:module";

import type {
  JobRunner,
  JobRunnerContext,
  JobRunnerResult,
} from "@agent-native/core/server";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

const registered = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  registerJobRunner: (id: string, runner: unknown) => {
    registered.set(id, runner);
    return () => registered.delete(id);
  },
}));

import { factoryMigrations } from "../plugins/factory-migrations.js";
import type { WorkflowScope, WorkflowStore } from "../workflow/adapter.js";
import {
  fixed,
  fromPath,
  buildGraph,
  rule,
} from "../workflow/story-graphs.fixture.js";
import {
  normalizedItem,
  sourceResult,
} from "../workflow/testing/engine-fixtures.js";
import {
  FakeClock,
  FakeOperationExecutor,
  failure,
  ok,
} from "../workflow/testing/fakes.js";
import { registerWorkflowJobRunner } from "./register-job-runner.js";
import { createSampleItemLoader } from "./run-requests.js";
import { createDrizzleWorkflowStore } from "./store.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "support-triage" };
const OWNER = "creator@example.test";
const CLICKER = "teammate@example.test";
const JOB_NAME = "factories/support-triage/workflow-leads-1a2b3c4d";
const JOB_ID = "resource-leads";
const T0 = "2026-10-19T12:15:00.000Z";

const RESET_TABLES = [
  "factory_workflows",
  "factory_workflow_versions",
  "factory_workflow_runs",
  "factory_workflow_steps",
  "factory_workflow_item_state",
  "factory_workflow_item_events",
  "factory_workflow_receipts",
  "factory_workflow_run_requests",
  "factory_poll_cursors",
  "factory_items",
];

let sharedClient: PGliteClient | undefined;

async function emptyClient(): Promise<PGliteClient> {
  if (!sharedClient) {
    sharedClient = await PGlite.create("memory://");
    for (const migration of factoryMigrations) {
      if (typeof migration.sql === "string") {
        await sharedClient.exec(migration.sql);
      }
    }
  }
  await sharedClient.exec(`TRUNCATE ${RESET_TABLES.join(", ")}`);
  return sharedClient;
}

afterAll(async () => {
  await sharedClient?.close();
  sharedClient = undefined;
});

// A small real workflow: leads from a provider, the strong ones to Slack.
const graph = buildGraph({
  nodes: [
    ["every15", "trigger", { schedule: { every: "15m" } }],
    [
      "leads",
      "source",
      {
        source: "provider-query",
        operation: "hubspot.newLeads",
        args: {},
        memory: "inbox",
        maxItems: 50,
      },
    ],
    [
      "strong",
      "filter",
      { combinator: "all", rules: [rule("item.extras.score", "gt", 50)] },
    ],
    [
      "tell",
      "action",
      {
        operation: "slack.postMessage",
        args: { to: fixed("C0SALES"), text: fromPath("item.title") },
      },
    ],
    ["done", "end", { outcome: "done" }],
    ["skip", "end", { outcome: "dismissed", reason: "not a strong lead" }],
  ],
  edges: [
    ["every15", "out", "leads"],
    ["leads", "out", "strong"],
    ["strong", "match", "tell"],
    ["tell", "out", "done"],
    ["strong", "otherwise", "skip"],
  ],
});

const lead = (id: string, score: number | undefined) =>
  normalizedItem(id, {
    kind: "lead",
    provider: "hubspot",
    title: `Lead ${id}`,
    extras: score === undefined ? {} : { score },
  });

describe("the registered workflow runner, end to end on PostgreSQL (PGlite)", () => {
  let client: PGliteClient;
  let store: WorkflowStore;
  let clock: FakeClock;
  let operations: FakeOperationExecutor;
  let log: Mock<(message: string) => void>;
  let workflowId: string;
  let runner: JobRunner;
  let historyCount = 0;

  async function rows(sql: string, params: unknown[] = []) {
    return (await client.query(sql, params)).rows as Record<string, unknown>[];
  }

  function context(overrides: Partial<JobRunnerContext> = {}) {
    historyCount += 1;
    return {
      name: JOB_NAME,
      path: `jobs/${JOB_NAME}.md`,
      meta: { schedule: "*/15 * * * *", enabled: true, runner: "workflow" },
      ownerEmail: OWNER,
      orgId: SCOPE.orgId,
      historyId: `history-${historyCount}`,
      manual: false,
      scheduledFor: T0,
      deadlineAt: Date.parse(T0) + 5 * 60_000,
      hardDeadlineAt: Date.parse(T0) + 5 * 60_000 + 20_000,
      signal: new AbortController().signal,
      assertCanContinue: async () => {},
      actionAutomation: { triggerId: JOB_ID, triggerName: JOB_NAME },
      ...overrides,
    } as JobRunnerContext;
  }
  const manualContext = (overrides: Partial<JobRunnerContext> = {}) =>
    context({ manual: true, scheduledFor: null, ...overrides });

  /** What core would see: the runner's result, or the failure it would record. */
  async function outcome(
    ctx: JobRunnerContext,
  ): Promise<
    | { result: JobRunnerResult }
    | { error: Error & { errorCode?: string; details?: unknown } }
  > {
    try {
      return { result: await runner(ctx) };
    } catch (error) {
      return { error: error as Error & { errorCode?: string } };
    }
  }

  /** Registers the runner the way the plugin does, over this database and these provider answers. */
  function register(executor: FakeOperationExecutor) {
    const db = drizzle(client);
    registered.clear();
    registerWorkflowJobRunner({
      store: () => store,
      loadSampleItems: createSampleItemLoader(() => db),
      hostDeps: {
        store,
        getDatabase: () => db,
        operations: executor,
        clock,
        actions: async () => ({}),
      },
      log,
    });
    runner = registered.get("workflow") as JobRunner;
  }

  async function enable() {
    await store.recordCleanDryRun(SCOPE, { workflowId, version: 1 });
    await store.setWorkflowEnabled(SCOPE, workflowId, true);
  }

  const request = (input: Record<string, unknown> = {}) =>
    store.createRunRequest(SCOPE, {
      workflowId,
      mode: "dry",
      requestedBy: CLICKER,
      ...input,
    } as never);

  const runRows = () =>
    rows(
      `SELECT mode, status, trigger_kind, started_by, tick_key, history_row_id, error_code
       FROM factory_workflow_runs ORDER BY started_at, id`,
    );

  beforeEach(async () => {
    client = await emptyClient();
    const db = drizzle(client);
    clock = new FakeClock(T0);
    store = createDrizzleWorkflowStore({
      getDatabase: () => db,
      clock: () => clock.now(),
    });
    operations = new FakeOperationExecutor();
    operations.script("hubspot.newLeads", () =>
      sourceResult([lead("lead-1", 80), lead("lead-2", 10)], {
        cursor: "cursor-1",
      }),
    );
    operations.always("slack.postMessage", () =>
      ok(
        { ts: "1760000000.000100" },
        {
          externalRef: "1760000000.000100",
          url: "https://slack.example.test/p1",
        },
      ),
    );
    log = vi.fn<(message: string) => void>();
    const workflow = await store.createWorkflow(SCOPE, {
      name: "Leads to sales",
      graph,
      ownerEmail: OWNER,
      automationId: JOB_ID,
    });
    workflowId = workflow.id;
    register(operations);
  });

  it("registers itself once under the id jobs name in `runner:`", () => {
    expect([...registered.keys()]).toEqual(["workflow"]);
    expect(typeof runner).toBe("function");
  });

  describe("a live scheduled tick", () => {
    beforeEach(enable);

    it("takes the items, writes the effect once with a receipt, and resolves the items", async () => {
      const ctx = context();

      const done = await outcome(ctx);

      expect(done).toMatchObject({
        result: { status: "success", runId: expect.any(String) },
      });
      const sends = operations.callsTo("slack.postMessage");
      expect(sends).toHaveLength(1);
      expect(sends[0]).toMatchObject({
        mode: "live",
        fields: { to: "C0SALES", text: "Lead lead-1" },
        receiptKey: expect.any(String),
      });
      expect(
        await rows(
          `SELECT status, external_ref FROM factory_workflow_receipts`,
        ),
      ).toEqual([{ status: "done", external_ref: "1760000000.000100" }]);
      expect(
        await rows(`SELECT id, status FROM factory_items ORDER BY id`),
      ).toEqual([
        { id: "lead-1", status: "resolved" },
        { id: "lead-2", status: "dismissed" },
      ]);
      expect(await runRows()).toEqual([
        {
          mode: "live",
          status: "succeeded",
          trigger_kind: "schedule",
          started_by: "schedule",
          tick_key: T0,
          history_row_id: ctx.historyId,
          error_code: null,
        },
      ]);
      expect((await store.getWorkflow(SCOPE, workflowId))?.lastTriggerAt).toBe(
        T0,
      );
    });

    it("does nothing the second time the scheduler hands over the same tick", async () => {
      const first = await outcome(context());
      expect(first).toMatchObject({ result: { status: "success" } });

      const second = await outcome(context());

      expect(second).toMatchObject({ result: { status: "skipped" } });
      expect(operations.callsTo("hubspot.newLeads")).toHaveLength(1);
      expect(operations.callsTo("slack.postMessage")).toHaveLength(1);
      expect(await runRows()).toHaveLength(1);
    });

    it("stops at the soft deadline, keeps the run paused in its own row, and still reports a success", async () => {
      const ctx = context({ deadlineAt: Date.parse(T0) - 1 });

      const done = await outcome(ctx);

      expect(done).toMatchObject({ result: { status: "success" } });
      expect(await runRows()).toMatchObject([{ status: "paused" }]);
      expect(operations.callsTo("slack.postMessage")).toHaveLength(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("run_paused"));
    });

    it("throws a failed run with its code, and leaves the run row failed", async () => {
      register(
        new FakeOperationExecutor().script("hubspot.newLeads", () =>
          failure("provider_error", {
            message: "HubSpot is down",
            retryable: false,
          }),
        ),
      );

      const done = await outcome(context());

      expect(done).toMatchObject({ error: { errorCode: "provider_error" } });
      expect((done as { error: Error }).error.message).toContain(
        "HubSpot is down",
      );
      expect(await runRows()).toMatchObject([
        { status: "failed", error_code: "provider_error" },
      ]);
    });
  });

  describe("a switched-off workflow", () => {
    it("is refused for real, whoever asks and however it is asked", async () => {
      await request({ mode: "live" });

      for (const ctx of [context(), manualContext(), manualContext()]) {
        expect(await outcome(ctx)).toMatchObject({
          error: { errorCode: "workflow_disabled" },
        });
      }
      expect(operations.calls).toHaveLength(0);
      expect(await runRows()).toEqual([]);
    });
  });

  describe("a dry run", () => {
    it("runs the whole graph for a switched-off workflow, touches nothing outside, and earns the clean dry run", async () => {
      const asked = await request();
      const ctx = manualContext();

      const done = await outcome(ctx);

      expect(done).toMatchObject({ result: { status: "success" } });
      // Reads ran for real; the write was only described.
      expect(operations.callsTo("hubspot.newLeads")).toHaveLength(1);
      expect(operations.callsTo("hubspot.newLeads")[0]?.mode).toBe("dry");
      expect(operations.callsTo("slack.postMessage")).toHaveLength(0);
      expect(await rows(`SELECT 1 FROM factory_workflow_receipts`)).toEqual([]);
      expect(await rows(`SELECT 1 FROM factory_items`)).toEqual([]);
      expect(await runRows()).toEqual([
        {
          mode: "dry",
          status: "succeeded",
          trigger_kind: "dry_run",
          started_by: CLICKER,
          tick_key: `manual:${asked.id}`,
          history_row_id: ctx.historyId,
          error_code: null,
        },
      ]);
      expect(
        (await store.getWorkflow(SCOPE, workflowId))?.lastCleanDryRunVersion,
      ).toBe(1);
      expect((await store.getWorkflow(SCOPE, workflowId))?.lastTriggerAt).toBe(
        null,
      );
    });

    it("does not earn it when an item failed on the way", async () => {
      await request();
      register(
        new FakeOperationExecutor().script("hubspot.newLeads", () =>
          sourceResult([lead("lead-1", 80), lead("lead-2", undefined)], {
            cursor: "cursor-1",
          }),
        ),
      );

      const done = await outcome(manualContext());

      expect(done).toMatchObject({ result: { status: "success" } });
      expect(
        (await store.getWorkflow(SCOPE, workflowId))?.lastCleanDryRunVersion,
      ).toBeNull();
    });
  });

  describe("a test run", () => {
    beforeEach(async () => {
      await enable();
      await outcome(context());
      operations.calls.length = 0;
    });

    it("runs one node on the pinned inbox items and nothing else", async () => {
      const asked = await request({
        mode: "test",
        testNodeId: "strong",
        sampleItemIds: ["lead-1"],
      });

      const done = await outcome(manualContext());

      expect(done).toMatchObject({ result: { status: "success" } });
      expect(operations.calls).toHaveLength(0);
      const run = (await runRows()).find((row) => row.mode === "test");
      expect(run).toMatchObject({
        mode: "test",
        trigger_kind: "test",
        started_by: CLICKER,
        tick_key: `manual:${asked.id}`,
      });
      const steps = await rows(
        `SELECT node_id, status FROM factory_workflow_steps
         WHERE run_id = (SELECT id FROM factory_workflow_runs WHERE mode = 'test')`,
      );
      expect(steps).toEqual([{ node_id: "strong", status: "succeeded" }]);
    });

    it("fails, with a code, when a pinned item is not in this factory's inbox", async () => {
      await request({
        mode: "test",
        testNodeId: "strong",
        sampleItemIds: ["not-an-item"],
      });

      expect(await outcome(manualContext())).toMatchObject({
        error: { errorCode: "sample_item_not_found" },
      });
      expect(
        await rows(`SELECT 1 FROM factory_workflow_runs WHERE mode = 'test'`),
      ).toEqual([]);
    });
  });

  describe("run requests", () => {
    it("are claimed by exactly one of two ticks started at once", async () => {
      await request();

      const both = await Promise.all([
        outcome(manualContext()),
        outcome(manualContext()),
      ]);

      // One tick got the dry run; the other had nothing asked of it, and
      // a switched-off workflow does not run for real.
      expect(both.filter((entry) => "result" in entry)).toHaveLength(1);
      expect(
        both.filter(
          (entry) =>
            "error" in entry && entry.error.errorCode === "workflow_disabled",
        ),
      ).toHaveLength(1);
      expect(await runRows()).toMatchObject([{ mode: "dry" }]);
    });

    it("are dropped after ten minutes, with a log, and the late tick fails instead of running", async () => {
      const stale = await request({ mode: "live" });
      clock.advance(11 * 60_000);

      const done = await outcome(manualContext());

      expect(done).toMatchObject({
        error: { errorCode: "run_request_expired" },
      });
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          `run_request_expired: live request ${stale.id}`,
        ),
      );
      expect(operations.calls).toHaveLength(0);
      expect(await store.getRunRequest(SCOPE, stale.id)).toBeNull();
    });
  });

  describe("a job with no workflow", () => {
    it("is a typed failure, never a quiet skip", async () => {
      const done = await outcome(
        context({
          actionAutomation: {
            triggerId: "resource-gone",
            triggerName: JOB_NAME,
          },
        }),
      );

      expect(done).toMatchObject({ error: { errorCode: "config_invalid" } });
      expect(operations.calls).toHaveLength(0);
    });
  });
});
