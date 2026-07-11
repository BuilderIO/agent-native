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
const sendMessageToTargetMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
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

const actionsToEngineToolsMock = vi.hoisted(() => vi.fn(() => []));

// `filterInitialEngineTools`'s own filtering semantics are covered directly
// (unmocked) by production-agent.spec.ts. Re-implemented minimally here
// rather than via `vi.importActual` on the real module, which would pull in
// production-agent.ts's full module graph (e.g. its module-scope
// `registerBuiltinEngines()` call) that this file's narrower mocks don't
// support. This only needs to prove scheduler.ts WIRES the filter with the
// right inputs, not re-prove the filter's own correctness.
function fakeFilterInitialEngineTools(
  tools: Array<{ name: string }>,
  initialToolNames?: string[],
): Array<{ name: string }> {
  if (!initialToolNames) return tools;
  const defaultNames = new Set([
    "resources",
    "docs-search",
    "get-framework-context",
    "read-attachment",
  ]);
  const names = new Set(initialToolNames);
  names.add("tool-search");
  for (const tool of tools) {
    if (defaultNames.has(tool.name)) names.add(tool.name);
  }
  return tools.filter((tool) => names.has(tool.name));
}

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: actionsToEngineToolsMock,
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  runAgentLoop: runAgentLoopMock,
  filterInitialEngineTools: fakeFilterInitialEngineTools,
}));

vi.mock("../agent/run-manager.js", () => ({
  resolveRunSoftTimeoutMs: vi.fn(() => 0),
  startRun: startRunMock,
}));

vi.mock("../usage/store.js", () => ({
  recordUsage: recordUsageMock,
}));

vi.mock("../integrations/adapters/index.js", () => ({
  getDefaultAdapter: () => ({
    formatAgentResponse: (text: string) => ({ text, platformContext: {} }),
    sendMessageToTarget: sendMessageToTargetMock,
  }),
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

  it("defers framework-added tools behind tool-search on the first job request when an initial tool list is supplied", async () => {
    actionsToEngineToolsMock.mockImplementation(
      (actionsMap: Record<string, { tool: { description: string } }>) =>
        Object.keys(actionsMap).map((name) => ({
          name,
          description: actionsMap[name].tool.description,
          inputSchema: { type: "object", properties: {} },
        })),
    );
    const noopTool = (description: string) => ({
      tool: { description, parameters: { type: "object", properties: {} } },
      run: async () => "ok",
    });

    await processRecurringJobs({
      getActions: () => ({
        "template-job-action": noopTool("A job-relevant app action"),
        "list-integration-memory": noopTool("Framework addition"),
      }),
      getInitialToolNames: () => ["template-job-action"],
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(runAgentLoopMock).toHaveBeenCalledOnce();
    const call = runAgentLoopMock.mock.calls[0]?.[0];
    const firstRequestToolNames = call.tools
      .map((tool: { name: string }) => tool.name)
      .sort();
    const availableToolNames = call.availableTools
      .map((tool: { name: string }) => tool.name)
      .sort();

    expect(firstRequestToolNames).toEqual([
      "template-job-action",
      "tool-search",
    ]);
    expect(firstRequestToolNames).not.toContain("list-integration-memory");
    expect(availableToolNames).toEqual([
      "list-integration-memory",
      "template-job-action",
      "tool-search",
    ]);
  });

  // The agent-chat plugin now wires `getInitialToolNames` for real (it used
  // to be unset, making the filter above a no-op) to:
  //   [...template action names, "manage-jobs", "manage-progress"]
  // "manage-jobs" and "manage-progress" are taught BY NAME in the shared
  // framework prompt this job runner reuses from interactive chat (see
  // FRAMEWORK_CORE's "Recurring jobs" bullet and SHARED_RULE_14 in
  // server/prompts/*.ts) — both must stay visible on the very first job
  // request even though jobTools/progressTools are merged into getActions()
  // alongside a much larger framework-addition surface
  // (automationTools/notificationTools/fetchTool/webSearchTool/toolActions)
  // that should stay deferred behind tool-search.
  it("keeps manage-jobs and manage-progress visible on the first request alongside the app's own actions (real plugin wiring shape)", async () => {
    actionsToEngineToolsMock.mockImplementation(
      (actionsMap: Record<string, { tool: { description: string } }>) =>
        Object.keys(actionsMap).map((name) => ({
          name,
          description: actionsMap[name].tool.description,
          inputSchema: { type: "object", properties: {} },
        })),
    );
    const noopTool = (description: string) => ({
      tool: { description, parameters: { type: "object", properties: {} } },
      run: async () => "ok",
    });

    await processRecurringJobs({
      getActions: () => ({
        "template-job-action": noopTool("A job-relevant app action"),
        "manage-jobs": noopTool("Create/list/update recurring jobs"),
        "manage-progress": noopTool("Track multi-step progress"),
        "manage-automations": noopTool("Framework addition — not taught"),
        "manage-notifications": noopTool("Framework addition — not taught"),
      }),
      // Mirrors agent-chat-plugin.ts's schedulerDeps.getInitialToolNames:
      // template action names plus the two tool names the shared prompt
      // teaches by name for this surface.
      getInitialToolNames: () => [
        "template-job-action",
        "manage-jobs",
        "manage-progress",
      ],
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(runAgentLoopMock).toHaveBeenCalledOnce();
    const call = runAgentLoopMock.mock.calls[0]?.[0];
    const firstRequestToolNames: string[] = call.tools
      .map((tool: { name: string }) => tool.name)
      .sort();

    expect(firstRequestToolNames).toEqual([
      "manage-jobs",
      "manage-progress",
      "template-job-action",
      "tool-search",
    ]);
    expect(firstRequestToolNames).not.toContain("manage-automations");
    expect(firstRequestToolNames).not.toContain("manage-notifications");
  });

  it("keeps every action visible on the first job request when no initial tool list is supplied (unchanged default)", async () => {
    actionsToEngineToolsMock.mockImplementation(
      (actionsMap: Record<string, { tool: { description: string } }>) =>
        Object.keys(actionsMap).map((name) => ({
          name,
          description: actionsMap[name].tool.description,
          inputSchema: { type: "object", properties: {} },
        })),
    );
    const noopTool = (description: string) => ({
      tool: { description, parameters: { type: "object", properties: {} } },
      run: async () => "ok",
    });

    await processRecurringJobs({
      getActions: () => ({
        "template-job-action": noopTool("A job-relevant app action"),
        "other-framework-action": noopTool("Some other action"),
      }),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(runAgentLoopMock).toHaveBeenCalledOnce();
    const call = runAgentLoopMock.mock.calls[0]?.[0];
    const firstRequestToolNames = call.tools
      .map((tool: { name: string }) => tool.name)
      .sort();
    // No filtering applied and no tool-search attached — identical to the
    // prior behavior when the caller doesn't opt into initial-tool filtering.
    expect(firstRequestToolNames).toEqual([
      "other-framework-action",
      "template-job-action",
    ]);
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

  it("delivers a channel-bound routine through its managed adapter target", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-channel",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/channel-digest.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
originScopeId: scope-1
deliveryPlatform: slack
deliveryDestination: C123
deliveryThreadRef: 123.456
deliveryTenantId: T123
---

Post the digest.`,
      },
    ]);
    startRunMock.mockImplementationOnce(
      (
        runId: string,
        threadId: string,
        runFn: (
          send: (event: unknown) => void,
          signal: AbortSignal,
        ) => Promise<void>,
        onComplete?: (run: any) => void | Promise<void>,
      ) => {
        const abort = new AbortController();
        const activeRun = { runId, threadId, status: "running", abort };
        void Promise.resolve().then(async () => {
          await runFn(vi.fn(), abort.signal);
          activeRun.status = "completed";
          await onComplete?.({
            ...activeRun,
            events: [{ seq: 0, event: { type: "text", text: "Digest ready" } }],
          });
        });
        return activeRun;
      },
    );

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(sendMessageToTargetMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Digest ready" }),
      {
        destination: "C123",
        threadRef: "123.456",
        tenantId: "T123",
      },
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
