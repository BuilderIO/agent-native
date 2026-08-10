import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTriggerContent,
  parseTriggerFrontmatter,
} from "../triggers/dispatcher.js";
import {
  classifyJobResource,
  processRecurringJobs,
  runJobNow,
} from "./scheduler.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());
const sendMessageToTargetMock = vi.hoisted(() => vi.fn());
const runAgentLoopWrapperMock = vi.hoisted(() => vi.fn());

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
    // Default: user exists and (when checked) is an org member. rowsAffected: 1
    // also lets the background run's self-claim CAS UPDATE (see
    // background-automation-runner.ts) succeed by default.
    dbExecuteMock.mockResolvedValue({ rows: [{ "1": 1 }], rowsAffected: 1 });
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
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { owner: string; path: string; content: string }) => {
        await resourcePutMock(input.owner, input.path, input.content);
        return { id: input.owner + input.path };
      },
    );
    // Model a real store: a re-read returns whatever was last written. The
    // scheduler re-reads before recording an outcome, and treats a missing
    // resource as deleted mid-run.
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
          ? {
              id: listed?.id ?? "resource-1",
              owner,
              path,
              content: written[2],
            }
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
    // The scheduler runs through the resume wrapper; delegate so the existing
    // assertions about what the loop was called with still read the same call.
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

  it("does not manually overlap an active automation", async () => {
    const resource = {
      id: "resource-running",
      owner: "alice+jobs@agent-native.test",
      path: "jobs/daily-report.md",
      updatedAt: "2026-08-04T00:00:00.000Z",
      content: `---
schedule: "* * * * *"
enabled: true
createdBy: alice+jobs@agent-native.test
lastRun: "${new Date().toISOString()}"
lastStatus: running
---

Summarize the inbox.`,
    };
    resourceGetByPathMock.mockResolvedValueOnce(resource);

    const result = await runJobNow(resource.owner, "daily-report", {
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(result).toEqual({
      status: "skipped",
      error: "The automation is already running.",
    });
    expect(resourcePutIfCurrentMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });

  it("seeds a scheduled automation without dropping its automation metadata", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-scheduled-automation",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/calendar-digest.md",
        content: buildTriggerContent(
          {
            schedule: "0 9 * * 1-5",
            enabled: true,
            triggerType: "schedule",
            condition: 'only when the calendar says "busy"',
            mode: "agentic",
            domain: "calendar",
            delegatedPolicyId: "calendar-safe:v1",
            createdBy: "alice+jobs@agent-native.test",
            orgId: "org-1",
            appId: "calendar",
            runAs: "creator",
            originScopeId: "scope-1",
            deliveryPlatform: "slack",
            deliveryDestination: "C012345",
            deliveryThreadRef: "1785343277.030909",
            deliveryTenantId: "T012345",
            model: "test-model",
            mcpTools: ["mcp__calendar__list_events"],
          },
          "Send the calendar digest.",
        ),
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
      appId: "calendar",
    });

    expect(resourcePutMock).toHaveBeenCalledOnce();
    const persistedContent: string = resourcePutMock.mock.calls[0][2];
    expect(classifyJobResource(persistedContent)).toEqual({
      kind: "automation",
      hasExplicitTriggerType: true,
      triggerType: "schedule",
    });
    const { meta, body } = parseTriggerFrontmatter(persistedContent);
    expect(meta).toMatchObject({
      schedule: "0 9 * * 1-5",
      enabled: true,
      triggerType: "schedule",
      condition: 'only when the calendar says "busy"',
      mode: "agentic",
      domain: "calendar",
      delegatedPolicyId: "calendar-safe:v1",
      createdBy: "alice+jobs@agent-native.test",
      orgId: "org-1",
      runAs: "creator",
      originScopeId: "scope-1",
      deliveryPlatform: "slack",
      deliveryDestination: "C012345",
      deliveryThreadRef: "1785343277.030909",
      deliveryTenantId: "T012345",
      model: "test-model",
      mcpTools: ["mcp__calendar__list_events"],
    });
    expect(meta.nextRun).toBeTruthy();
    expect(body).toBe("Send the calendar digest.");
    expect(createThreadMock).not.toHaveBeenCalled();
  });

  it("does not execute an automation owned by another app", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-calendar-automation",
        owner: "__organization__:org-1",
        path: "jobs/calendar-digest.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
triggerType: schedule
appId: calendar
createdBy: alice+jobs@agent-native.test
orgId: org-1
runAs: creator
---

Send the calendar digest.`,
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
      appId: "factory",
    });

    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(resourcePutMock).not.toHaveBeenCalled();
  });

  it("does not claim an organization job whose app owner is missing", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-unscoped-organization-job",
        owner: "__organization__:org-1",
        path: "jobs/factory-slack-feedback.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
orgId: org-1
runAs: creator
---

Process the feedback.`,
      },
    ]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
      appId: "mail",
    });

    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(resourcePutMock).not.toHaveBeenCalled();
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
    expect(runAgentLoopWrapperMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCaller: "automation",
        automation: {
          triggerId: "resource-1",
          triggerName: "daily-report",
        },
      }),
      expect.any(Number),
      expect.any(Object),
    );
  });

  it("runs multiple due automations from one scan without serial starvation", async () => {
    let releaseFirst: () => void = () => {};
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let runCount = 0;
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-first",
        owner: "__shared__",
        path: "jobs/first.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: __shared__
---

Run the first job.`,
      },
      {
        id: "resource-second",
        owner: "__shared__",
        path: "jobs/second.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: __shared__
---

Run the second job.`,
      },
    ]);
    runAgentLoopWrapperMock.mockImplementation(async () => {
      runCount += 1;
      if (runCount === 1) await firstRunGate;
      return {
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        model: "test-model",
      };
    });

    const scan = processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });
    let bothRunsStarted = false;
    try {
      await vi.waitFor(() => expect(runCount).toBe(2), { timeout: 1000 });
      bothRunsStarted = true;
    } finally {
      releaseFirst();
    }

    await scan;
    expect(bothRunsStarted).toBe(true);
    expect(runCount).toBe(2);
  });

  it("allows a later scheduler scan to run while an earlier job is active", async () => {
    let releaseFirst: () => void = () => {};
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let resolveFirstStarted: () => void = () => {};
    const firstRunStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let runCount = 0;
    resourceListAllOwnersMock
      .mockResolvedValueOnce([
        {
          id: "resource-first-scan",
          owner: "__shared__",
          path: "jobs/first-scan.md",
          content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: __shared__
---

Run the first scan job.`,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "resource-second-scan",
          owner: "__shared__",
          path: "jobs/second-scan.md",
          content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: __shared__
---

Run the second scan job.`,
        },
      ]);
    runAgentLoopWrapperMock.mockImplementation(async () => {
      runCount += 1;
      if (runCount === 1) {
        resolveFirstStarted();
        await firstRunGate;
      }
      return {
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        model: "test-model",
      };
    });

    const firstScan = processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });
    await firstRunStarted;

    const secondScan = processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });
    let laterRunStarted = false;
    try {
      await vi.waitFor(() => expect(runCount).toBe(2), { timeout: 1000 });
      laterRunStarted = true;
    } finally {
      releaseFirst();
    }

    await Promise.all([firstScan, secondScan]);
    expect(laterRunStarted).toBe(true);
    expect(runCount).toBe(2);
  });

  it("caps the number of scheduled automations active in one process", async () => {
    const resources = Array.from({ length: 9 }, (_, index) => ({
      id: `resource-cap-${index}`,
      owner: "__shared__",
      path: `jobs/cap-${index}.md`,
      content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: __shared__
---

Run capped job ${index}.`,
    }));
    resourceListAllOwnersMock.mockResolvedValueOnce(resources);
    let releaseJobs: () => void = () => {};
    const allJobsGate = new Promise<void>((resolve) => {
      releaseJobs = resolve;
    });
    let runCount = 0;
    runAgentLoopWrapperMock.mockImplementation(async () => {
      runCount += 1;
      await allJobsGate;
      return {
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        model: "test-model",
      };
    });

    const scan = processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });
    let capacityObserved = false;
    try {
      await vi.waitFor(() => expect(runCount).toBe(8), { timeout: 1000 });
      capacityObserved = true;
    } finally {
      releaseJobs();
    }

    await scan;
    expect(capacityObserved).toBe(true);
    expect(runCount).toBe(8);
  });

  it("does not let blocked jobs starve a later valid job", async () => {
    const resources = Array.from({ length: 9 }, (_, index) => {
      const owner =
        index < 8
          ? `blocked-${index}@agent-native.test`
          : "valid@agent-native.test";
      return {
        id: `resource-blocked-${index}`,
        owner,
        path: `jobs/blocked-${index}.md`,
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: ${owner}
---

Run job ${index}.`,
      };
    });
    resourceListAllOwnersMock.mockResolvedValueOnce(resources);
    dbExecuteMock.mockImplementation(
      async (query: { sql?: string; args?: unknown[] }) => {
        const email = query.args?.[0];
        if (
          query.sql?.includes('FROM "user"') &&
          typeof email === "string" &&
          email.startsWith("blocked-")
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [{ "1": 1 }], rowsAffected: 1 };
      },
    );
    let runCount = 0;
    runAgentLoopWrapperMock.mockImplementation(async () => {
      runCount += 1;
      return {
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        model: "test-model",
      };
    });

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(runCount).toBe(1);
    expect(
      resourcePutMock.mock.calls.filter((call) =>
        String(call[2]).includes("lastStatus: skipped"),
      ),
    ).toHaveLength(8);
    expect(
      resourcePutMock.mock.calls.some(
        (call) =>
          call[0] === "valid@agent-native.test" &&
          call[1] === "jobs/blocked-8.md",
      ),
    ).toBe(true);
  });

  it("rotates past recently recorded identity failures", async () => {
    const resources = Array.from({ length: 34 }, (_, index) => {
      const owner =
        index < 33
          ? `blocked-${index}@agent-native.test`
          : "valid@agent-native.test";
      return {
        id: `resource-rotate-${index}`,
        owner,
        path: `jobs/rotate-${index}.md`,
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: ${owner}
---

Run job ${index}.`,
      };
    });
    const contentByKey = new Map(
      resources.map((resource) => [
        `${resource.owner}:${resource.path}`,
        resource.content,
      ]),
    );
    resourceListAllOwnersMock.mockImplementation(async () =>
      resources.map((resource) => ({
        ...resource,
        content:
          contentByKey.get(`${resource.owner}:${resource.path}`) ??
          resource.content,
      })),
    );
    resourcePutMock.mockImplementation(
      async (owner: string, path: string, content: string) => {
        contentByKey.set(`${owner}:${path}`, content);
      },
    );
    dbExecuteMock.mockImplementation(
      async (query: { sql?: string; args?: unknown[] }) => {
        const email = query.args?.[0];
        if (
          query.sql?.includes('FROM "user"') &&
          typeof email === "string" &&
          email.startsWith("blocked-")
        ) {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [{ "1": 1 }], rowsAffected: 1 };
      },
    );
    let runCount = 0;
    runAgentLoopWrapperMock.mockImplementation(async () => {
      runCount += 1;
      return {
        inputTokens: 100,
        outputTokens: 25,
        cacheReadTokens: 10,
        cacheWriteTokens: 5,
        model: "test-model",
      };
    });

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });
    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(runCount).toBe(1);
    expect(
      resourcePutMock.mock.calls.filter((call) =>
        String(call[2]).includes("lastStatus: skipped"),
      ),
    ).toHaveLength(33);
  });

  it("passes persisted MCP capabilities to the background action suppliers", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-mcp",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/hourly-meeting-todos.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
mcpTools: ["mcp__meeting-notes__list_meetings"]
---

Import action items.`,
      },
    ]);
    const getActions = vi.fn(() => ({
      "mcp__meeting-notes__list_meetings": {
        tool: {
          description: "List meetings",
          parameters: { type: "object", properties: {} },
        },
        run: async () => "ok",
      },
    }));
    const getInitialToolNames = vi.fn(() => ["manage-jobs"]);

    await processRecurringJobs({
      getActions,
      getInitialToolNames,
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(getActions).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hourly-meeting-todos",
        meta: expect.objectContaining({
          mcpTools: ["mcp__meeting-notes__list_meetings"],
        }),
      }),
    );
    expect(getInitialToolNames).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          mcpTools: ["mcp__meeting-notes__list_meetings"],
        }),
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

  it("marks the job run as background dispatch so the stale reaper uses the background window", async () => {
    // dispatch_mode NULL falls through to RUN_STALE_MS (15s) in
    // backgroundAwareStaleCutoffSql — a window sized for a foreground run a
    // browser is streaming. Nothing streams a job, so it gets reaped mid-run.
    // dispatch_mode now gets there via the runner's own pre-claim, not via
    // startRun's options — see background-automation-runner.spec.ts for the
    // dedicated self-claim regression test.
    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(startRunMock).toHaveBeenCalledOnce();
    expect(startRunMock.mock.calls[0][4]).not.toHaveProperty("dispatchMode");
  });

  it("runs the job through the resume wrapper instead of calling runAgentLoop raw", async () => {
    runAgentLoopWrapperMock.mockImplementation(async () => ({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: "test-model",
    }));

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(runAgentLoopWrapperMock).toHaveBeenCalledOnce();
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });

  it("records a run_timeout continuation boundary as an error and suppresses delivery", async () => {
    // The soft timeout emits auto_continue{run_timeout} and the run row is
    // still status 'completed'. Without the cut-off check the job is reported
    // as a success and its truncated partial answer is shipped to Slack.
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-cutoff",
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
            events: [
              { seq: 0, event: { type: "text", text: "Half a digest" } },
              {
                seq: 1,
                event: { type: "auto_continue", reason: "run_timeout" },
              },
            ],
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

    expect(sendMessageToTargetMock).not.toHaveBeenCalled();
    const putContent: string = resourcePutMock.mock.calls.at(-1)![2];
    expect(putContent).toContain("lastStatus: error");
    expect(putContent).toContain("run_timeout");
  });

  it("still records a job that resumed past a continuation boundary as a success", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-resumed",
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
            events: [
              {
                seq: 0,
                event: { type: "auto_continue", reason: "network_interrupted" },
              },
              { seq: 1, event: { type: "text", text: "Digest ready" } },
              { seq: 2, event: { type: "done" } },
            ],
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

    expect(sendMessageToTargetMock).toHaveBeenCalledOnce();
    const putContent: string = resourcePutMock.mock.calls.at(-1)![2];
    expect(putContent).toContain("lastStatus: success");
  });

  it("does not recreate a job deleted while it was running", async () => {
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-doomed",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/channel-digest.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
---

Post the digest.`,
      },
    ]);
    // Deleted mid-run: the re-read finds nothing.
    resourceGetByPathMock.mockResolvedValue(null);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    // The "mark as running" write happened before the delete; the completion
    // write must not follow it and resurrect the job.
    const writesAfterStart = resourcePutMock.mock.calls.filter((call) =>
      String(call[2]).includes("lastStatus: success"),
    );
    expect(writesAfterStart).toHaveLength(0);
  });

  it("keeps a schedule edited mid-run instead of restoring the pre-run copy", async () => {
    // The run holds the frontmatter it started with. Writing that snapshot
    // back on completion would silently undo the user's edit.
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-edited",
        owner: "alice+jobs@agent-native.test",
        path: "jobs/channel-digest.md",
        content: `---
schedule: "0 8 * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
---

Post the digest.`,
      },
    ]);
    // While the job runs, the user moves it to 9pm Tokyo and edits the body.
    resourceGetByPathMock.mockResolvedValue({
      id: "resource-edited",
      owner: "alice+jobs@agent-native.test",
      path: "jobs/channel-digest.md",
      content: `---
schedule: "0 21 * * *"
timezone: Asia/Tokyo
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: alice+jobs@agent-native.test
---

Post the revised digest.`,
    });

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    const putContent: string = resourcePutMock.mock.calls.at(-1)![2];
    expect(putContent).toContain('schedule: "0 21 * * *"');
    expect(putContent).toContain('timezone: "Asia/Tokyo"');
    expect(putContent).toContain("Post the revised digest.");
    expect(putContent).toContain("lastStatus: success");
    // nextRun follows the edited schedule: 21:00 Tokyo is 12:00 UTC.
    expect(putContent).toContain('nextRun: "');
    expect(putContent).toMatch(/nextRun: "[\d-]+T12:00:00\.000Z"/);
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
    expect(putContent).toContain("timed out or been recycled");
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

  it("does not record a lastRun for a tick that never ran the job", async () => {
    // A job whose run-as user no longer exists is skipped on every tick. It
    // must not report a run it never performed — the reason goes in lastError
    // and the evaluation time in lastCheck.
    dbExecuteMock.mockResolvedValue({ rows: [] });
    resourceListAllOwnersMock.mockResolvedValueOnce([
      {
        id: "resource-blocked",
        owner: "ghost@agent-native.test",
        path: "jobs/blocked-job.md",
        content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: ghost@agent-native.test
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

    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(resourcePutMock).toHaveBeenCalledOnce();
    const content: string = resourcePutMock.mock.calls[0][2];
    expect(content).toContain("lastStatus: skipped");
    expect(content).toContain("no longer exists");
    expect(content).toContain("lastCheck:");
    expect(content).not.toContain("lastRun:");
  });

  it("stops rewriting a blocked job once its failure state is recorded", async () => {
    // The skip path used to persist the resource on every 60s tick, churning
    // the poll stream and moving the displayed timestamp forever.
    dbExecuteMock.mockResolvedValue({ rows: [] });
    const blocked = {
      id: "resource-blocked",
      owner: "ghost@agent-native.test",
      path: "jobs/blocked-job.md",
      content: `---
schedule: "* * * * *"
nextRun: "1970-01-01T00:00:00.000Z"
enabled: true
createdBy: ghost@agent-native.test
lastStatus: skipped
lastError: "user \\"ghost@agent-native.test\\" no longer exists"
---

Do some work.`,
    };
    resourceListAllOwnersMock.mockResolvedValueOnce([blocked]);

    await processRecurringJobs({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      engine: testEngine,
      model: "test-model",
    });

    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(resourcePutMock).not.toHaveBeenCalled();
  });
});
