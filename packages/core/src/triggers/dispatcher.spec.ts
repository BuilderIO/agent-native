import { beforeEach, describe, expect, it, vi } from "vitest";
import { initTriggerDispatcher } from "./dispatcher.js";

const resourceListAllOwnersMock = vi.hoisted(() => vi.fn());
const resourcePutMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());

vi.mock("../resources/store.js", () => ({
  resourceListAllOwners: resourceListAllOwnersMock,
  resourcePut: resourcePutMock,
}));

vi.mock("../event-bus/index.js", () => ({
  subscribe: subscribeMock,
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: vi.fn(() => []),
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  runAgentLoop: runAgentLoopMock,
}));

vi.mock("../agent/engine/index.js", () => ({
  createAnthropicEngine: vi.fn(() => ({})),
}));

vi.mock("./condition-evaluator.js", () => ({
  evaluateCondition: vi.fn(async () => true),
}));

describe("trigger dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    runAgentLoopMock.mockResolvedValue(undefined);
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
