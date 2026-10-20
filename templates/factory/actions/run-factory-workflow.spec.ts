import { patchJobFrontmatterFields } from "@agent-native/core/jobs/frontmatter";
import {
  SelfDispatchHttpError,
  SelfDispatchNetworkError,
} from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queueAutomationRunNowMock = vi.hoisted(() => vi.fn());
const listAutomationRunsMock = vi.hoisted(() => vi.fn());
const getRunMock = vi.hoisted(() => vi.fn());
const recordTripwireMock = vi.hoisted(() => vi.fn());

vi.mock("../server/workflow-host/factory-read-models.js", () => ({
  getWorkflowReadModels: () => ({ getRun: getRunMock }),
}));

vi.mock("@agent-native/core/action", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.actionModule;
});
vi.mock("@agent-native/core/resources", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.resourcesModule;
});
vi.mock("@agent-native/core/jobs", async (importActual) => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.jobsModule(await importActual<Record<string, unknown>>());
});
vi.mock("@agent-native/core/triggers", () => ({
  queueAutomationRunNow: queueAutomationRunNowMock,
  listAutomationRuns: listAutomationRunsMock,
}));
vi.mock("../server/tripwire/index.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/tripwire/index.js")>()),
  recordTripwire: recordTripwireMock,
}));
vi.mock("../server/workflow-host/factory-store.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.workflowStoreModule;
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.factoryDefinitionsModule;
});

import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import { WORKFLOW_STORE_LIMITS } from "../server/workflow/adapter.js";
import { STORY_GRAPHS } from "../server/workflow/story-graphs.fixture.js";
import runWorkflow from "./run-factory-workflow.js";
import save from "./save-factory-workflow.js";
import setEnabled from "./set-factory-workflow-enabled.js";

const runSave = kit.runOf(save);
const runEnable = kit.runOf(setEnabled);
const run = kit.runOf(runWorkflow);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

async function createWorkflow(options: { enabled?: boolean } = {}) {
  const created = await runSave(
    { factoryId: kit.FACTORY_ID, name: "Digest", graph: kit.simpleGraph() },
    kit.context,
  );
  if (options.enabled) {
    await kit.currentStore().recordCleanDryRun(scope, {
      workflowId: created.workflowId,
      version: 1,
    });
    await runEnable(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        enabled: true,
      },
      kit.context,
    );
  }
  return created as {
    workflowId: string;
    job: { automationId: string; path: string };
  };
}

const request = (workflowId: string, input: Record<string, unknown> = {}) =>
  run(
    { factoryId: kit.FACTORY_ID, workflowId, mode: "dry", ...input },
    kit.context,
  );

const claim = (workflowId: string) =>
  kit
    .currentStore()
    .claimRunRequest(scope, { workflowId, historyId: "history-1" });

beforeEach(() => {
  kit.reset();
  vi.clearAllMocks();
  getRunMock.mockReset();
  listAutomationRunsMock.mockReset();
  listAutomationRunsMock.mockResolvedValue([]);
  queueAutomationRunNowMock.mockResolvedValue({
    queued: true,
    runId: "history-7",
    automationRunId: "history-7",
  });
});

describe("run-factory-workflow", () => {
  it("queues a dry run of a switched-off workflow through core's run-now, with the click's details waiting in a request", async () => {
    const created = await createWorkflow();

    const result = await request(created.workflowId);

    expect(result).toEqual({
      requestId: expect.any(String),
      runId: "history-7",
      status: "queued",
    });
    expect(queueAutomationRunNowMock).toHaveBeenCalledTimes(1);
    expect(queueAutomationRunNowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: kit.USER_EMAIL,
        orgId: kit.ORG_ID,
        appId: "factory",
        scope: "organization",
        path: created.job.path,
      }),
    );
    const stored = await kit
      .currentStore()
      .getRunRequest(scope, result.requestId);
    expect(stored).toMatchObject({
      workflowId: created.workflowId,
      mode: "dry",
      requestedBy: kit.USER_EMAIL,
      claimedAt: null,
    });
  });

  it("writes the request before it asks core to run, so the tick always finds it", async () => {
    const created = await createWorkflow();
    queueAutomationRunNowMock.mockImplementation(async () => {
      expect((await claim(created.workflowId)).claimed).toMatchObject({
        mode: "dry",
      });
      return { queued: true, runId: "history-7", automationRunId: "history-7" };
    });

    await request(created.workflowId);

    expect(queueAutomationRunNowMock).toHaveBeenCalledTimes(1);
  });

  it("queues a test run of one node on the items it pins", async () => {
    const created = await createWorkflow();

    const result = await request(created.workflowId, {
      mode: "test",
      testNodeId: "finish",
      sampleItemIds: ["item-1", "item-2"],
    });

    expect(
      await kit.currentStore().getRunRequest(scope, result.requestId),
    ).toMatchObject({
      mode: "test",
      testNodeId: "finish",
      sampleItemIds: ["item-1", "item-2"],
    });
  });

  it("queues a live run only for a workflow that is switched on", async () => {
    const off = await createWorkflow();
    const refused = await kit.failureOf(() =>
      request(off.workflowId, { mode: "live" }),
    );
    expect(refused).toMatchObject({
      errorCode: "workflow_disabled",
      statusCode: 409,
    });
    expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
    expect((await claim(off.workflowId)).claimed).toBeNull();

    kit.reset();
    const on = await createWorkflow({ enabled: true });
    const result = await request(on.workflowId, { mode: "live" });
    expect(
      await kit.currentStore().getRunRequest(scope, result.requestId),
    ).toMatchObject({ mode: "live" });
  });

  it("refuses a test run with no node, an unknown node, or a dry run that names one, and queues nothing", async () => {
    const created = await createWorkflow();
    const refusals = [
      [{ mode: "test" }, "test_node_required", 400],
      [{ mode: "test", testNodeId: "ghost" }, "workflow_node_not_found", 404],
      [{ mode: "dry", testNodeId: "finish" }, "invalid_request", 400],
      [{ mode: "live", sampleItemIds: ["item-1"] }, "invalid_request", 400],
    ] as const;

    for (const [input, errorCode, statusCode] of refusals) {
      expect(
        await kit.failureOf(() => request(created.workflowId, input)),
      ).toMatchObject({ errorCode, statusCode });
    }

    expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
    expect((await claim(created.workflowId)).claimed).toBeNull();
  });

  it("answers for a workflow that is not in the factory, or whose job file is gone", async () => {
    expect(await kit.failureOf(() => request("nope"))).toMatchObject({
      errorCode: "workflow_not_found",
      statusCode: 404,
    });

    const created = await createWorkflow();
    kit.removeJob(created.job.path);
    expect(
      await kit.failureOf(() => request(created.workflowId)),
    ).toMatchObject({ errorCode: "workflow_job_missing", statusCode: 409 });
    expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
    expect((await claim(created.workflowId)).claimed).toBeNull();
  });

  it("takes the request back when core refuses before it queues anything", async () => {
    const created = await createWorkflow();
    queueAutomationRunNowMock.mockRejectedValue(
      Object.assign(new Error("Automation not found."), { statusCode: 404 }),
    );

    const failure = await kit.failureOf(() => request(created.workflowId));

    expect(failure).toMatchObject({
      errorCode: "run_not_queued",
      statusCode: 404,
    });
    expect(failure.message).toContain("Automation not found.");
    // Left in place, the next unrelated manual run would claim it.
    expect((await claim(created.workflowId)).claimed).toBeNull();
  });

  it("keeps the request when the dispatch fails after core queued a run, so the redelivered tick finds it", async () => {
    const created = await createWorkflow();
    queueAutomationRunNowMock.mockRejectedValue(new Error("fetch failed"));

    const failure = await kit.failureOf(() => request(created.workflowId));

    expect(failure).toMatchObject({
      errorCode: "run_dispatch_failed",
      statusCode: 502,
      details: { workflowId: created.workflowId },
    });
    const kept = await kit
      .currentStore()
      .getRunRequest(scope, failure.details?.requestId as string);
    expect(kept).toMatchObject({ mode: "dry", claimedAt: null });
    expect((await claim(created.workflowId)).claimed?.id).toBe(kept?.id);
  });

  it("names where the dispatch went and why it failed, so a hosted failure can be read from the error", async () => {
    const created = await createWorkflow();
    queueAutomationRunNowMock.mockRejectedValue(
      new SelfDispatchNetworkError(
        "/_agent-native/agent-chat/_process-run",
        "http://localhost:3000",
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        }),
      ),
    );

    const refused = await kit.failureOf(() => request(created.workflowId));

    expect(refused).toMatchObject({
      errorCode: "run_dispatch_failed",
      statusCode: 502,
      details: {
        workflowId: created.workflowId,
        errorClass: "SelfDispatchNetworkError",
        target: "http://localhost:3000",
        causeCode: "ECONNREFUSED",
      },
    });
    expect(refused.message).toContain("at http://localhost:3000 failed");
    expect(refused.message).toContain("fetch failed (ECONNREFUSED)");

    queueAutomationRunNowMock.mockRejectedValue(
      new SelfDispatchHttpError(
        "Self-dispatch to /_agent-native/agent-chat/_process-run returned HTTP 502 Bad Gateway",
        502,
        undefined,
        "https://factory.example.test",
      ),
    );

    const answered = await kit.failureOf(() => request(created.workflowId));

    expect(answered).toMatchObject({
      errorCode: "run_dispatch_failed",
      details: {
        errorClass: "SelfDispatchHttpError",
        httpStatus: 502,
        target: "https://factory.example.test",
      },
    });
    expect(answered.message).toContain("(at https://factory.example.test)");
  });

  it("with waitSeconds, waits for the run and returns the workflow run id, whether it was clean, and the steps that failed", async () => {
    const created = await runSave(
      {
        factoryId: kit.FACTORY_ID,
        name: "Digest",
        graph: STORY_GRAPHS["morning-digest"],
      },
      kit.context,
    );
    const step = (nodeId: string, status: string, error: unknown = null) => ({
      nodeId,
      nodeName: nodeId,
      nodeKind: "action",
      status,
      error,
    });
    getRunMock.mockResolvedValueOnce(null).mockResolvedValue({
      run: {
        id: "run-9",
        mode: "dry",
        status: "failed",
        graphVersion: 1,
        counts: { itemFailures: 0 },
        error: {
          code: "credential_missing",
          message: "Slack is not connected",
        },
      },
      steps: [
        step("commits", "succeeded"),
        step("post", "failed", {
          code: "credential_missing",
          message: "slack is not connected",
        }),
      ],
      stepsTruncated: false,
    });

    const result = await request(created.workflowId, { waitSeconds: 5 });

    expect(getRunMock).toHaveBeenCalledWith(scope, "history-7");
    expect(result).toMatchObject({
      status: "finished",
      runId: "history-7",
      workflowRunId: "run-9",
      runStatus: "failed",
      clean: false,
      failedSteps: [
        {
          nodeId: "post",
          error: {
            code: "credential_missing",
            message: "slack is not connected",
          },
        },
      ],
      needsConnection: ["slack"],
    });
  });

  it("with waitSeconds, answers still_running with both ids when the run does not end in time", async () => {
    const created = await createWorkflow();
    getRunMock.mockResolvedValue({
      run: { id: "run-9", mode: "dry", status: "running", graphVersion: 1 },
      steps: [],
      stepsTruncated: false,
    });
    const started = Date.now();

    const result = await request(created.workflowId, { waitSeconds: 1 });

    expect(Date.now() - started).toBeLessThan(2_500);
    expect(result).toEqual({
      requestId: expect.any(String),
      runId: "history-7",
      status: "still_running",
      workflowRunId: "run-9",
      waitedSeconds: 1,
    });
  });

  it("limits how long a call may wait", () => {
    const input = (runWorkflow as unknown as { schema: any }).schema;
    const parse = (waitSeconds: number) =>
      input.safeParse({
        factoryId: kit.FACTORY_ID,
        workflowId: "wf",
        mode: "dry",
        waitSeconds,
      }).success;
    expect([parse(25), parse(26), parse(0)]).toEqual([true, false, false]);
  });

  it("caps the pinned items at what the store accepts", () => {
    const input = (runWorkflow as unknown as { schema: any }).schema;
    expect(
      input.safeParse({
        factoryId: kit.FACTORY_ID,
        workflowId: "wf",
        mode: "test",
        testNodeId: "n",
        sampleItemIds: Array.from(
          { length: WORKFLOW_STORE_LIMITS.runRequestSampleItemsMax + 1 },
          (_, i) => `item-${i}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("declares what it can do for MCP and what it audits", () => {
    const action = runWorkflow as unknown as {
      mcpAnnotations: Record<string, boolean>;
      audit: {
        target: (args: { workflowId: string }) => unknown;
        summary: (args: any, result: unknown) => string;
      };
    };

    // A live run can send, write and merge, so the one declaration is the strict one.
    expect(action.mcpAnnotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(action.audit.target({ workflowId: "wf-1" })).toEqual({
      type: "factory-workflow",
      id: "wf-1",
      visibility: "org",
    });
    expect(
      action.audit.summary(
        { workflowId: "wf-1", mode: "test", testNodeId: "assess" },
        { status: "queued" },
      ),
    ).toBe("Queued a test run of workflow wf-1 at node assess");
  });
});

describe("run-factory-workflow: which failures are safe to repeat", () => {
  const { retrySafe } = runWorkflow as unknown as {
    retrySafe: (input: Record<string, unknown>) => boolean;
  };

  it("repeats a dry or test run freely, and a live run only when its arguments were refused before anything was queued", () => {
    expect(retrySafe({ mode: "dry" })).toBe(true);
    expect(retrySafe({ mode: "test", testNodeId: "assess" })).toBe(true);
    expect(retrySafe({ mode: "live" })).toBe(false);
    expect(retrySafe({ mode: "live", testNodeId: "assess" })).toBe(true);
    expect(retrySafe({ mode: "live", sampleItemIds: ["item-1"] })).toBe(true);
  });
});

describe("run-factory-workflow: two runs of one workflow at once", () => {
  const refusedRow = (id: string) => ({
    id,
    status: "error",
    error: "The automation is already running. No delivery was confirmed.",
    errorCode: null,
  });

  it("answers `skipped` at once, not after the whole wait, when the scheduler refused the second run", async () => {
    const created = await createWorkflow();
    listAutomationRunsMock.mockResolvedValue([refusedRow("history-7")]);
    getRunMock.mockResolvedValue(null);
    const started = Date.now();

    const result = await request(created.workflowId, { waitSeconds: 25 });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toEqual({
      requestId: expect.any(String),
      runId: "history-7",
      status: "skipped",
      reason: "already_running",
      message: expect.stringContaining("did not start"),
    });
    expect(listAutomationRunsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owners: [kit.orgOwner()],
        appId: "factory",
      }),
    );
  });

  it("names the run that was going, takes its own request back", async () => {
    const created = await createWorkflow();
    listAutomationRunsMock.mockResolvedValue([refusedRow("history-7")]);
    getRunMock.mockResolvedValue(null);
    queueAutomationRunNowMock.mockImplementation(async () => {
      kit.seedJob(
        created.job.path,
        patchJobFrontmatterFields(kit.readJob(created.job.path) as string, {
          lastStatus: "running",
          lastHistoryId: "history-3",
        }),
      );
      return { queued: true, runId: "history-7", automationRunId: "history-7" };
    });

    const result = await request(created.workflowId, { waitSeconds: 25 });

    expect(result).toMatchObject({
      status: "skipped",
      activeRunId: "history-3",
    });
    // Left in place, the next manual run would claim it and run this mode.
    expect((await claim(created.workflowId)).claimed).toBeNull();
  });

  it("reports a run the scheduler ended for any other reason with its code, instead of waiting", async () => {
    const created = await createWorkflow();
    listAutomationRunsMock.mockResolvedValue([
      {
        id: "history-7",
        status: "error",
        error: "Workflow is switched off.",
        errorCode: "workflow_disabled",
      },
    ]);
    getRunMock.mockResolvedValue(null);

    const result = await request(created.workflowId, { waitSeconds: 25 });

    expect(result).toMatchObject({
      status: "not_started",
      schedulerStatus: "error",
      errorCode: "workflow_disabled",
      message: "Workflow is switched off.",
    });
  });

  it("keeps waiting the way it did when the scheduler's history cannot be read, and says why in the log", async () => {
    const created = await createWorkflow();
    listAutomationRunsMock.mockRejectedValue(new Error("history is down"));
    getRunMock.mockResolvedValue(null);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await request(created.workflowId, { waitSeconds: 1 });

    expect(result).toMatchObject({
      status: "still_running",
      workflowRunId: null,
    });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("could not read the scheduler's history"),
      expect.any(Error),
    );
    error.mockRestore();
  });

  describe("when the job is already marked as running", () => {
    async function createRunning() {
      const created = await createWorkflow();
      kit.seedJob(
        created.job.path,
        patchJobFrontmatterFields(kit.readJob(created.job.path) as string, {
          lastStatus: "running",
          lastHistoryId: "history-3",
        }),
      );
      return created;
    }

    it("tells an agent before queueing anything, so no request, history row or failure mail is left behind", async () => {
      const created = await createRunning();

      const result = await run(
        {
          factoryId: kit.FACTORY_ID,
          workflowId: created.workflowId,
          mode: "dry",
        },
        kit.agentContext,
      );

      expect(result).toEqual({
        status: "skipped",
        reason: "already_running",
        activeRunId: "history-3",
        message: expect.stringContaining("did not start"),
      });
      expect(queueAutomationRunNowMock).not.toHaveBeenCalled();
      expect((await claim(created.workflowId)).claimed).toBeNull();
    });

    it("still queues a run the app's own button asked for, which expects a run id back", async () => {
      const created = await createRunning();

      const result = await request(created.workflowId);

      expect(result).toMatchObject({ status: "queued", runId: "history-7" });
      expect(queueAutomationRunNowMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("run-factory-workflow: what the tripwires record", () => {
  it("throws what it always did", async () => {
    const created = await createWorkflow();
    queueAutomationRunNowMock.mockRejectedValue(
      new SelfDispatchNetworkError(
        "/_agent-native/agent-chat/_process-run",
        "http://localhost:3000",
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        }),
      ),
    );

    const refused = await kit.failureOf(() => request(created.workflowId));

    expect(refused).toMatchObject({
      errorCode: "run_dispatch_failed",
      statusCode: 502,
    });
  });
});
