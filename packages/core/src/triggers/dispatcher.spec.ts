import { beforeEach, describe, expect, it, vi } from "vitest";

import { initTriggerDispatcher } from "./dispatcher.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const unsubscribeMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const dbExecuteMock = vi.hoisted(() => vi.fn());
const getDbExecMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  resourceListAllOwners: resourceListAllOwnersMock,
  resourcePut: resourcePutMock,
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
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user exists and (when checked) is an org member.
    dbExecuteMock.mockResolvedValue({ rows: [{ "1": 1 }] });
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
    resourcePutMock.mockResolvedValue(undefined);
    createThreadMock.mockResolvedValue({ id: "thread-1" });
    subscribeMock.mockImplementation((eventName: string) => `sub-${eventName}`);
    runAgentLoopMock.mockResolvedValue({
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      model: "test-model",
    });
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
      expect.objectContaining({ threadId: "thread-1" }),
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
});
