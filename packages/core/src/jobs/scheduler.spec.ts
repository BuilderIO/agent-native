import { beforeEach, describe, expect, it, vi } from "vitest";

import { processRecurringJobs } from "./scheduler.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  resourceListAllOwners: resourceListAllOwnersMock,
  resourcePut: resourcePutMock,
  resourceGet: vi.fn(),
}));

vi.mock("../resources/emitter.js", () => ({
  getResourcesEmitter: () => ({ on: vi.fn() }),
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: vi.fn(() => []),
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  runAgentLoop: runAgentLoopMock,
}));

vi.mock("../agent/run-manager.js", () => ({
  resolveRunSoftTimeoutMs: vi.fn(() => 0),
  startRun: startRunMock,
}));

vi.mock("../usage/store.js", () => ({
  recordUsage: recordUsageMock,
}));

// Partial-mock db/client so the user/membership validation lookup is
// stubbed (audit 12 #10) but other consumers (auth shim, onboarding HTML
// loaded transitively via `getDbExec`) still see real exports.
vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getDbExec: getDbExecMock,
  };
});

const testEngine = {
  name: "test",
  defaultModel: "test-model",
  supportedModels: ["test-model"],
} as any;

describe("processRecurringJobs", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    // Default: user exists and (when checked) is an org member.
    dbExecuteMock.mockResolvedValue({ rows: [{ "1": 1 }] });
    getDbExecMock.mockReturnValue({ execute: dbExecuteMock });
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-1",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/daily-report.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
---

Summarize the inbox.`,
      },
    ]);
    resourcePutMock.mockResolvedValue(undefined);
    createThreadMock.mockResolvedValue({ id: "thread-1" });
    runAgentLoopMock.mockResolvedValue({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      model: "test-model",
    });
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
        const activeRun = {
          runId,
          threadId,
          status: "running",
          abort,
        };
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

  it("creates run history threads owned by the job user", async () => {
    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(createThreadMock).toHaveBeenCalledWith(
      "alice+jobs@agent-native.test",
      expect.objectContaining({
        title: expect.stringContaining("Job: daily-report"),
      }),
    );
  });

  it("loads prompt resources for the effective run owner", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-1",
        owner: "__shared__",
        path: "jobs/shared-daily-report.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
runAs: creator
---

Summarize the inbox.`,
      },
    ]);
    const getSystemPrompt = vi.fn(async () => "system");

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt,
      engine: testEngine,
      model: "test-model",
    });

    expect(getSystemPrompt).toHaveBeenCalledWith(
      "alice+jobs@agent-native.test",
    );
  });

  it("does not publish job ownership through process.env", async () => {
    process.env.AGENT_USER_EMAIL = "stale@example.com";
    process.env.AGENT_ORG_ID = "stale-org";

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(process.env.AGENT_USER_EMAIL).toBe("stale@example.com");
    expect(process.env.AGENT_ORG_ID).toBe("stale-org");
  });

  it("records recurring job usage with job label and run ref", async () => {
    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
      appId: "mail",
    });

    expect(recordUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "alice+jobs@agent-native.test",
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        model: "test-model",
        label: "recurring-job:daily-report",
        app: "mail",
        refId: expect.stringMatching(/^job-daily-report-\d+-[a-z0-9]+$/),
      }),
    );
  });

  it("resets a job stuck in lastStatus:running after 10+ minutes without executing it", async () => {
    // P2 stale-running recovery: a serverless kill mid-job leaves
    // lastStatus:"running" forever. The scheduler must detect runs that have
    // been "running" for > 10 minutes (stuck-guard) and reset them to "error"
    // without re-executing, then let the NEXT tick pick them up normally.
    const stuckLastRun = new Date(Date.now() - 11 * 60 * 1000).toISOString(); // 11 minutes ago

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-stuck",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/stuck-job.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
lastStatus: running
lastRun: ${stuckLastRun}
---

Do some work.`,
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    // The job must NOT have been executed — it should be skipped this tick.
    expect(createThreadMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();

    // The resource must have been updated to reset the stuck run to "error".
    expect(resourcePutMock).toHaveBeenCalledOnce();
    const putCall = resourcePutMock.mock.calls[0][1]; // path argument
    expect(putCall).toBe("jobs/stuck-job.md");
    const putContent: string = resourcePutMock.mock.calls[0][2]; // content argument
    expect(putContent).toContain("lastStatus: error");
    expect(putContent).toContain("timed out or server crashed");
  });

  it("does not reset a job that has been running for less than 10 minutes", async () => {
    // A job that started < 10 min ago is still running legitimately — leave it.
    const recentLastRun = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago

    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-running",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/running-job.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
lastStatus: running
lastRun: ${recentLastRun}
---

Do some work.`,
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    // Still within 10-minute window — must be skipped without resetting.
    expect(createThreadMock).not.toHaveBeenCalled();
    expect(resourcePutMock).not.toHaveBeenCalled();
  });
});
