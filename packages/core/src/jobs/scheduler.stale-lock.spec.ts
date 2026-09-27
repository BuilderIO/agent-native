import { beforeEach, describe, expect, it, vi } from "vitest";

import * as runHistory from "./run-history.js";
import { processRecurringJobs, runJobNow } from "./scheduler.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const runAgentLoopWrapperMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());

vi.mock("../agent/run-loop-with-resume.js", () => ({
  runAgentLoopDirectWithSoftTimeout: runAgentLoopWrapperMock,
}));

vi.mock("../resources/store.js", () => ({
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  resourceListAllOwners: resourceListAllOwnersMock,
  resourcePut: resourcePutMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceGet: vi.fn(),
}));

vi.mock("../resources/emitter.js", () => ({
  getResourcesEmitter: () => ({ on: vi.fn() }),
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  getThread: vi.fn(async () => ({
    id: "thread-1",
    title: "Job",
    preview: "",
    threadData: "{}",
    messageCount: 0,
  })),
  updateThreadData: vi.fn(async () => {}),
  withThreadDataLock: async (_id: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: vi.fn(() => []),
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  resolveOwnerEngineApiKey: vi.fn(async () => ({
    apiKey: undefined,
    apiKeyEnvVar: undefined,
  })),
  runAgentLoop: runAgentLoopMock,
  filterInitialEngineTools: (tools: unknown[]) => tools,
}));

vi.mock("../agent/run-manager.js", () => ({
  resolveRunSoftTimeoutMs: vi.fn(() => 0),
  resolveBackgroundAutomationSoftTimeoutMs: vi.fn(() => 0),
  resolveBackgroundRunHardTimeoutMs: vi.fn(() => 10 * 60_000),
  startRun: startRunMock,
}));

vi.mock("../usage/store.js", () => ({
  recordUsage: recordUsageMock,
}));

vi.mock("./remote-execution.js", () => ({
  dispatchRemoteAutomation: vi.fn(),
  finishRemoteAutomationHistory: vi.fn(),
  getRemoteAutomationStatus: vi.fn(async () => ({ state: "not-remote" })),
}));

vi.mock("./scheduler-health.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scheduler-health.js")>();
  return { ...actual, recordAutomationSchedulerHealth: vi.fn(async () => {}) };
});

vi.mock("../integrations/adapters/index.js", () => ({
  getDefaultAdapter: () => ({
    formatAgentResponse: (text: string) => ({ text, platformContext: {} }),
    sendMessageToTarget: vi.fn(),
  }),
}));

vi.mock("../server/onboarding-html.js", () => ({
  getOnboardingHtml: vi.fn(),
  getResetPasswordHtml: vi.fn(),
}));

vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getDbExec: getDbExecMock };
});

const testEngine = {
  name: "test",
  defaultModel: "test-model",
  supportedModels: ["test-model"],
} as any;

describe("stale automation run-lock recovery across trigger types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbExecuteMock.mockResolvedValue({ rows: [{ "1": 1 }], rowsAffected: 1 });
    getDbExecMock.mockReturnValue({ execute: dbExecuteMock });
    resourcePutMock.mockResolvedValue(undefined);
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { owner: string; path: string; content: string }) => {
        await resourcePutMock(input.owner, input.path, input.content);
        return { id: input.owner + input.path };
      },
    );
    resourceGetByPathMock.mockImplementation(
      async (owner: string, path: string) => {
        const latestListCall = resourceListAllOwnersMock.mock.results.at(-1);
        const listedResources = latestListCall?.value
          ? await latestListCall.value
          : [];
        const listed = listedResources.find(
          (resource: { owner: string; path: string }) =>
            resource.owner === owner && resource.path === path,
        );
        const written = resourcePutMock.mock.calls
          .filter((call) => call[0] === owner && call[1] === path)
          .at(-1);
        return written
          ? { id: listed?.id ?? "resource-1", owner, path, content: written[2] }
          : (listed ?? null);
      },
    );
    createThreadMock.mockResolvedValue({ id: "thread-1" });
    runAgentLoopMock.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      model: "test-model",
    });
    runAgentLoopWrapperMock.mockImplementation((opts: unknown) =>
      runAgentLoopMock(opts),
    );
    startRunMock.mockImplementation(
      (
        runId: string,
        threadId: string,
        runFn: (
          send: (event: unknown) => void,
          signal: AbortSignal,
        ) => Promise<void>,
        onComplete?: (run: { status: string }) => void | Promise<void>,
      ) => {
        const abort = new AbortController();
        const activeRun = { runId, threadId, status: "running", abort };
        void Promise.resolve().then(async () => {
          try {
            await runFn(vi.fn(), abort.signal);
            activeRun.status = "completed";
          } catch {
            activeRun.status = "errored";
          }
          await onComplete?.(activeRun);
        });
        return activeRun;
      },
    );
    recordUsageMock.mockResolvedValue(undefined);
  });

  it("resets a stuck event automation with no cron schedule, not just cron jobs", async () => {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const stuckContent = [
      "---",
      'schedule: ""',
      "enabled: true",
      "createdBy: alice+jobs@agent-native.test",
      "triggerType: event",
      "event: order.created",
      "deliveryPlatform: slack",
      "deliveryDestination: C0123456",
      "lastStatus: running",
      "lastRun: " + stuckLastRun,
      "---",
      "",
      "Summarize the new order and post it to Slack.",
    ].join("\n");

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-stuck-event",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/slack-support.md",
        content: stuckContent,
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(createThreadMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();

    expect(resourcePutMock).toHaveBeenCalledOnce();
    const putCall = resourcePutMock.mock.calls[0][1];
    expect(putCall).toBe("jobs/slack-support.md");
    const putContent = resourcePutMock.mock.calls[0][2];
    expect(putContent).toContain("lastStatus: error");
    expect(putContent).toContain("timed out or been recycled");

    const unlockedResource = {
      id: "resource-stuck-event",
      owner: "alice+jobs@agent-native.test",
      path: "jobs/slack-support.md",
      updatedAt: "2026-08-04T00:00:00.000Z",
      content: putContent,
    };
    resourceGetByPathMock.mockResolvedValueOnce(unlockedResource);

    const result = await runJobNow(unlockedResource.owner, "slack-support", {
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(result.status).not.toBe("skipped");
    expect(runAgentLoopMock).toHaveBeenCalledOnce();
  });

  it("does not touch automation history when the stale-lock reset loses its CAS", async () => {
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    const stuckContent = [
      "---",
      'schedule: ""',
      "enabled: true",
      "createdBy: alice+jobs@agent-native.test",
      "triggerType: event",
      "event: order.created",
      "lastStatus: running",
      "lastRun: " + stuckLastRun,
      "---",
      "",
      "Do the thing.",
    ].join("\n");

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-race",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/race.md",
        content: stuckContent,
      },
    ]);
    resourcePutIfCurrentMock.mockResolvedValueOnce(null);
    const listAutomationRunsSpy = vi.spyOn(runHistory, "listAutomationRuns");

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    } as any);

    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(listAutomationRunsSpy).not.toHaveBeenCalled();
  });
});
