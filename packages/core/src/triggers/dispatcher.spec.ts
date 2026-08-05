import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import { buildTriggerContent, initTriggerDispatcher } from "./dispatcher.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const resourcePutIfCurrentMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const unsubscribeMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());

// The dispatcher runs through the resume wrapper. Delegate to the loop mock so
// every assertion below still reads the options the loop was called with.
vi.mock("../agent/run-loop-with-resume.js", () => ({
  runAgentLoopDirectWithSoftTimeout: (opts: unknown) => runAgentLoopMock(opts),
}));
const dbExecuteMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  organizationIdFromResourceOwner: (owner: string) =>
    owner.startsWith("__organization__:")
      ? owner.slice("__organization__:".length)
      : null,
  resourceListAllOwners: resourceListAllOwnersMock,
  resourceGetByPath: resourceGetByPathMock,
  resourcePut: resourcePutMock,
  resourcePutIfCurrent: resourcePutIfCurrentMock,
}));

vi.mock("../event-bus/index.js", () => ({
  subscribe: subscribeMock,
  unsubscribe: unsubscribeMock,
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
// support. This only needs to prove dispatcher.ts WIRES the filter with the
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

vi.mock("../usage/store.js", () => ({
  recordUsage: recordUsageMock,
}));

vi.mock("../agent/run-manager.js", () => ({
  resolveRunSoftTimeoutMs: vi.fn(() => 0),
  startRun: startRunMock,
}));

vi.mock("../agent/engine/index.js", () => ({
  getStoredModelForEngine: vi.fn(async () => undefined),
  normalizeModelForEngine: (
    engine: { defaultModel?: string },
    model?: string | null,
  ) => model ?? engine.defaultModel,
  resolveEngine: vi.fn(async () => ({
    name: "test-engine",
    defaultModel: "test-model",
  })),
}));

vi.mock("./condition-evaluator.js", () => ({
  evaluateCondition: vi.fn(async () => true),
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

describe("trigger dispatcher", () => {
  it("rejects delegated policy ids that could inject trigger frontmatter", () => {
    expect(() =>
      buildTriggerContent(
        {
          schedule: "",
          enabled: true,
          triggerType: "event",
          event: "clip.created",
          mode: "agentic",
          delegatedPolicyId: "crm-safe\nenabled: false",
        },
        "Review the clip.",
      ),
    ).toThrow("Delegated automation policy IDs");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user exists and (when checked) is an org member. rowsAffected: 1
    // also lets the background run's self-claim CAS UPDATE (see
    // background-automation-runner.ts) succeed by default.
    dbExecuteMock.mockResolvedValue({ rows: [{ "1": 1 }], rowsAffected: 1 });
    getDbExecMock.mockReturnValue({ execute: dbExecuteMock });
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-1",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/inbox-alert.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: test.event.fired
mode: agentic
createdBy: alice+triggers@agent-native.test
---

Respond to the event.`,
      },
    ]);
    resourceGetByPathMock.mockImplementation(
      async (owner: string, path: string) => {
        const latestListCall = resourceListAllOwnersMock.mock.results.at(-1);
        const resources = latestListCall?.value
          ? await latestListCall.value
          : [];
        return resources.find(
          (resource: { owner: string; path: string }) =>
            resource.owner === owner && resource.path === path,
        );
      },
    );
    resourcePutMock.mockResolvedValue(undefined);
    resourcePutIfCurrentMock.mockImplementation(
      async (input: { owner: string; path: string; content: string }) => {
        await resourcePutMock(input.owner, input.path, input.content);
        return { id: input.owner + input.path };
      },
    );
    createThreadMock.mockResolvedValue({ id: "thread-1" });
    subscribeMock.mockImplementation((eventName: string) => `sub-${eventName}`);
    runAgentLoopMock.mockResolvedValue({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
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

  it("defers framework-added tools behind tool-search on the first trigger request when an initial tool list is supplied", async () => {
    // Use a distinct event/resource path from the module-level default so
    // this test doesn't collide with `_eventSubscriptions` state left behind
    // by other tests in this file (the dispatcher module is a singleton that
    // isn't reset between tests, and skips re-subscribing an event it
    // already tracks).
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-tool-filter",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/tool-filter-alert.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: tool-filter.event.fired
mode: agentic
createdBy: alice+triggers@agent-native.test
---

Respond to the event.`,
      },
    ]);
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

    await initTriggerDispatcher({
      getActions: () => ({
        "template-trigger-action": noopTool("A trigger-relevant app action"),
        "list-integration-memory": noopTool("Framework addition"),
      }),
      getInitialToolNames: () => ["template-trigger-action"],
      getSystemPrompt: async () => "system",
      model: "test-model",
    });

    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "tool-filter.event.fired",
    )?.[1];
    expect(handler).toBeTypeOf("function");
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-1",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(runAgentLoopMock).toHaveBeenCalledOnce();
    const call = runAgentLoopMock.mock.calls[0]?.[0];
    const firstRequestToolNames = call.tools
      .map((tool: { name: string }) => tool.name)
      .sort();
    const availableToolNames = call.availableTools
      .map((tool: { name: string }) => tool.name)
      .sort();

    expect(firstRequestToolNames).toEqual([
      "template-trigger-action",
      "tool-search",
    ]);
    expect(firstRequestToolNames).not.toContain("list-integration-memory");
    expect(availableToolNames).toEqual([
      "list-integration-memory",
      "template-trigger-action",
      "tool-search",
    ]);
  });

  // The agent-chat plugin now wires `getInitialToolNames` for real (it used
  // to be unset, making the filter above a no-op) to:
  //   [...template action names, "manage-jobs", "manage-progress"]
  // "manage-jobs" and "manage-progress" are taught BY NAME in the shared
  // framework prompt this dispatcher reuses from interactive chat (see
  // FRAMEWORK_CORE's "Recurring jobs" bullet and SHARED_RULE_14 in
  // server/prompts/*.ts) — both must stay visible on the very first
  // automation-trigger request even though jobTools/progressTools are merged
  // into getActions() alongside a much larger framework-addition surface
  // (automationTools/notificationTools/fetchTool/webSearchTool/toolActions)
  // that should stay deferred behind tool-search.
  it("keeps manage-jobs and manage-progress visible on the first request alongside the app's own actions (real plugin wiring shape)", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-initial-tool-wiring",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/initial-tool-wiring-alert.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: initial-tool-wiring.event.fired
mode: agentic
createdBy: alice+triggers@agent-native.test
---

Respond to the event.`,
      },
    ]);
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

    await initTriggerDispatcher({
      getActions: () => ({
        "template-trigger-action": noopTool("A trigger-relevant app action"),
        "manage-jobs": noopTool("Create/list/update recurring jobs"),
        "manage-progress": noopTool("Track multi-step progress"),
        "manage-automations": noopTool("Framework addition — not taught"),
        "manage-notifications": noopTool("Framework addition — not taught"),
      }),
      // Mirrors agent-chat-plugin.ts's dispatcher deps getInitialToolNames:
      // template action names plus the two tool names the shared prompt
      // teaches by name for this surface.
      getInitialToolNames: () => [
        "template-trigger-action",
        "manage-jobs",
        "manage-progress",
      ],
      getSystemPrompt: async () => "system",
      model: "test-model",
    });

    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "initial-tool-wiring.event.fired",
    )?.[1];
    expect(handler).toBeTypeOf("function");
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-2",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(runAgentLoopMock).toHaveBeenCalledOnce();
    const call = runAgentLoopMock.mock.calls[0]?.[0];
    const firstRequestToolNames: string[] = call.tools
      .map((tool: { name: string }) => tool.name)
      .sort();

    expect(firstRequestToolNames).toEqual([
      "manage-jobs",
      "manage-progress",
      "template-trigger-action",
      "tool-search",
    ]);
    expect(firstRequestToolNames).not.toContain("manage-automations");
    expect(firstRequestToolNames).not.toContain("manage-notifications");
  });

  it("creates trigger run history threads owned by the trigger user", async () => {
    await initTriggerDispatcher({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      model: "test-model",
    });

    const handler = subscribeMock.mock.calls[0]?.[1];
    expect(handler).toBeTypeOf("function");
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-1",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(createThreadMock).toHaveBeenCalledWith(
      "alice+triggers@agent-native.test",
      expect.objectContaining({
        title: expect.stringContaining("Trigger: inbox-alert"),
      }),
    );
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        actionCaller: "automation",
        automation: {
          triggerId: "resource-1",
          triggerName: "inbox-alert",
          policyId: undefined,
        },
      }),
    );
  });

  it("passes a stored delegated policy only from trigger frontmatter", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-policy",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/crm-follow-up.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: crm.follow-up
mode: agentic
delegatedPolicyId: crm-sales-routine-local-v1
createdBy: alice+triggers@agent-native.test
---

Update the local follow-up status.`,
      },
    ]);

    await initTriggerDispatcher({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      model: "test-model",
    });
    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "crm.follow-up",
    )?.[1];
    expect(handler).toBeTypeOf("function");
    await handler(
      { recordId: "record-1" },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-policy",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCaller: "automation",
        automation: {
          triggerId: "resource-policy",
          triggerName: "crm-follow-up",
          policyId: "crm-sales-routine-local-v1",
        },
      }),
    );
  });

  it("records event automation usage with trigger label and event ref", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-usage",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/usage-alert.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: usage.event.record
mode: agentic
createdBy: alice+triggers@agent-native.test
---

Respond to the event.`,
      },
    ]);

    await initTriggerDispatcher({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
      model: "test-model",
      appId: "calendar",
    });

    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "usage.event.record",
    )?.[1];
    expect(handler).toBeTypeOf("function");
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-1",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(recordUsageMock).toHaveBeenCalledWith({
      ownerEmail: "alice+triggers@agent-native.test",
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      model: "test-model",
      label: "automation:usage-alert",
      app: "calendar",
      refId: "event-1",
    });
  });

  it("loads prompt resources for the trigger run owner", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-1",
        owner: "__shared__",
        path: "jobs/shared-inbox-alert.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: qa.event.prompt
mode: agentic
createdBy: alice+triggers@agent-native.test
runAs: creator
---

Respond to the event.`,
      },
    ]);
    const getSystemPrompt = vi.fn(async () => "system");

    await initTriggerDispatcher({
      getActions: () => ({}),
      getSystemPrompt,
      model: "test-model",
    });

    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "qa.event.prompt",
    )?.[1];
    expect(handler).toBeTypeOf("function");
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-1",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(getSystemPrompt).toHaveBeenCalledWith(
      "alice+triggers@agent-native.test",
    );
  });

  it("passes automation context to action suppliers and enforces persisted MCP tools", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-event-mcp",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/event-mcp.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: event.mcp.required
mode: agentic
createdBy: alice+triggers@agent-native.test
model: persisted-model
mcpTools: ["mcp__calendar__list_events"]
---

Read the calendar.`,
      },
    ]);
    const mcpEntry = {
      tool: {
        description: "List calendar events",
        parameters: { type: "object", properties: {} },
      },
      run: async () => "ok",
    };
    let observedRequestIdentity:
      | { userEmail?: string; orgId?: string }
      | undefined;
    const getActions = vi.fn(() => {
      observedRequestIdentity = {
        userEmail: getRequestUserEmail(),
        orgId: getRequestOrgId(),
      };
      return { mcp__calendar__list_events: mcpEntry };
    });
    const getInitialToolNames = vi.fn(() => ["manage-jobs"]);
    actionsToEngineToolsMock.mockImplementation(
      (actionsMap: Record<string, { tool: { description: string } }>) =>
        Object.keys(actionsMap).map((name) => ({
          name,
          description: actionsMap[name].tool.description,
          inputSchema: { type: "object", properties: {} },
        })),
    );

    await initTriggerDispatcher({
      getActions,
      getInitialToolNames,
      getSystemPrompt: async () => "system",
    });
    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "event.mcp.required",
    )?.[1];
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-mcp",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(getActions).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "event-mcp",
        meta: expect.objectContaining({
          mcpTools: ["mcp__calendar__list_events"],
        }),
      }),
    );
    expect(getInitialToolNames).toHaveBeenCalledWith(
      expect.objectContaining({ name: "event-mcp" }),
    );
    expect(observedRequestIdentity).toEqual({
      userEmail: "alice+triggers@agent-native.test",
      orgId: undefined,
    });
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "persisted-model",
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "mcp__calendar__list_events" }),
        ]),
      }),
    );
    // dispatch_mode is now set via the runner's own pre-claim (insertRun +
    // claimBackgroundRun) before startRun is even called, not through
    // startRun's options — see background-automation-runner.spec.ts.
    expect(startRunMock.mock.calls[0]?.[4]).not.toHaveProperty("dispatchMode");
  });

  it("fails loudly before execution when a requested event MCP tool is unavailable", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-event-mcp-missing",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/event-mcp-missing.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: event.mcp.missing
mode: agentic
createdBy: alice+triggers@agent-native.test
mcpTools: ["mcp__calendar__missing_tool"]
---

Read the calendar.`,
      },
    ]);

    await initTriggerDispatcher({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
    });
    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "event.mcp.missing",
    )?.[1];
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-mcp-missing",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(startRunMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    const persisted = resourcePutMock.mock.calls.at(-1)?.[2] as string;
    expect(persisted).toContain("lastStatus: error");
    expect(persisted).toContain("Configured MCP tools are unavailable");
    expect(persisted).toContain("mcp__calendar__missing_tool");
  });

  it("routes organization events only to their creator and fails closed when membership is unreadable", async () => {
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-org-event",
        owner: "__organization__:org-1",
        path: "jobs/org-event.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: event.org.creator
mode: agentic
createdBy: alice+triggers@agent-native.test
orgId: "org-1"
runAs: creator
---

Handle the organization event.`,
      },
    ]);

    await initTriggerDispatcher({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
    });
    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "event.org.creator",
    )?.[1];

    await handler(
      { ok: true },
      {
        owner: "bob+triggers@agent-native.test",
        eventId: "event-org-other-member",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );
    expect(resourcePutMock).not.toHaveBeenCalled();
    expect(startRunMock).not.toHaveBeenCalled();

    dbExecuteMock
      .mockResolvedValueOnce({ rows: [{ "1": 1 }] })
      .mockRejectedValueOnce(new Error("connection timeout"));
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-org-creator",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(startRunMock).not.toHaveBeenCalled();
    const persisted = resourcePutMock.mock.calls.at(-1)?.[2] as string;
    expect(persisted).toContain("lastStatus: skipped");
    expect(persisted).toContain(
      "Could not verify the automation execution identity",
    );
  });

  it("recovers an event automation left running past the shared stuck window", async () => {
    const staleRun = new Date(Date.now() - 11 * 60_000).toISOString();
    resourceListAllOwnersMock.mockResolvedValue([
      {
        id: "resource-stale-event",
        owner: "alice+triggers@agent-native.test",
        path: "jobs/stale-event.md",
        content: `---
schedule: ""
enabled: true
triggerType: event
event: event.stale.recovery
mode: agentic
createdBy: alice+triggers@agent-native.test
lastStatus: running
lastRun: "${staleRun}"
---

Recover and handle the event.`,
      },
    ]);

    await initTriggerDispatcher({
      getActions: () => ({}),
      getSystemPrompt: async () => "system",
    });
    const handler = subscribeMock.mock.calls.find(
      ([eventName]) => eventName === "event.stale.recovery",
    )?.[1];
    await handler(
      { ok: true },
      {
        owner: "alice+triggers@agent-native.test",
        eventId: "event-stale",
        emittedAt: "2026-04-30T00:00:00.000Z",
      },
    );

    expect(startRunMock).toHaveBeenCalledOnce();
    expect(runAgentLoopMock).toHaveBeenCalledOnce();
    const persisted = resourcePutMock.mock.calls.at(-1)?.[2] as string;
    expect(persisted).toContain("lastStatus: success");
  });
});
