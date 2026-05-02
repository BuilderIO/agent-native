import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "./types.js";
import type { PendingTask } from "./pending-tasks-store.js";

const getThreadMappingMock = vi.hoisted(() => vi.fn());
const saveThreadMappingMock = vi.hoisted(() => vi.fn());
const createThreadMock = vi.hoisted(() => vi.fn());
const getThreadMock = vi.hoisted(() => vi.fn());
const updateThreadDataMock = vi.hoisted(() => vi.fn());
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn());
const getOwnerActiveApiKeyMock = vi.hoisted(() => vi.fn());
const getOwnerApiKeyMock = vi.hoisted(() => vi.fn());
const runAgentLoopMock = vi.hoisted(() => vi.fn());
const actionsToEngineToolsMock = vi.hoisted(() => vi.fn());
const resolveEngineMock = vi.hoisted(() => vi.fn());
const getStoredModelForEngineMock = vi.hoisted(() => vi.fn());

vi.mock("./thread-mapping-store.js", () => ({
  getThreadMapping: getThreadMappingMock,
  saveThreadMapping: saveThreadMappingMock,
}));

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  getThread: getThreadMock,
  updateThreadData: updateThreadDataMock,
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

vi.mock("../agent/production-agent.js", () => ({
  getOwnerActiveApiKey: getOwnerActiveApiKeyMock,
  getOwnerApiKey: getOwnerApiKeyMock,
  engineToProvider: (engineName: string) =>
    engineName.startsWith("ai-sdk:")
      ? engineName.slice("ai-sdk:".length)
      : engineName,
  actionsToEngineTools: actionsToEngineToolsMock,
  runAgentLoop: runAgentLoopMock,
}));

vi.mock("../agent/engine/index.js", () => ({
  getStoredModelForEngine: getStoredModelForEngineMock,
  resolveEngine: resolveEngineMock,
}));

vi.mock("../agent/run-manager.js", () => ({
  startRun: vi.fn((runId, threadId, runFn, onComplete) => {
    const events: any[] = [];
    const send = (event: any) => {
      events.push({
        id: `event-${events.length + 1}`,
        runId,
        event,
        createdAt: Date.now(),
      });
    };
    Promise.resolve(runFn(send, new AbortController().signal)).then(() =>
      onComplete?.({
        runId,
        threadId,
        events,
        status: "completed",
        subscribers: new Set(),
        abort: new AbortController(),
        startedAt: Date.now(),
      }),
    );
    return {
      runId,
      threadId,
      events,
      status: "running",
      subscribers: new Set(),
      abort: new AbortController(),
      startedAt: Date.now(),
    };
  }),
}));

function createAdapter(sendResponse = vi.fn()): PlatformAdapter {
  return {
    platform: "fake",
    label: "Fake",
    getRequiredEnvKeys: () => [],
    handleVerification: async () => ({ handled: false }),
    verifyWebhook: async () => true,
    parseIncomingMessage: async () => null,
    sendResponse,
    formatAgentResponse: (text) => ({ text, platformContext: {} }),
    getStatus: async () => ({
      platform: "fake",
      label: "Fake",
      enabled: true,
      configured: true,
    }),
  };
}

describe("integration webhook handler engine resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getThreadMappingMock.mockResolvedValue(null);
    saveThreadMappingMock.mockResolvedValue(undefined);
    createThreadMock.mockResolvedValue({ id: "thread-qa" });
    getThreadMock.mockResolvedValue({ threadData: "{}" });
    updateThreadDataMock.mockResolvedValue(undefined);
    resolveOrgIdForEmailMock.mockResolvedValue("org-qa");
    getOwnerActiveApiKeyMock.mockResolvedValue(undefined);
    getOwnerApiKeyMock.mockResolvedValue(undefined);
    actionsToEngineToolsMock.mockReturnValue([]);
    getStoredModelForEngineMock.mockResolvedValue(undefined);
    resolveEngineMock.mockResolvedValue({
      name: "builder",
      defaultModel: "builder-default-model",
      stream: vi.fn(),
    });
    runAgentLoopMock.mockImplementation(async ({ engine, model, send }) => {
      send({
        type: "text",
        text: `resolved ${engine.name} ${model}`,
      });
    });
  });

  it("uses the shared engine resolver instead of forcing Anthropic", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn();
    const task: PendingTask = {
      id: "task-qa",
      platform: "fake",
      externalEventKey: "fake:thread-1:1001",
      externalThreadId: "thread-1",
      payload: JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "thread-1",
          text: "hello from slack",
          senderName: "QA User",
          platformContext: { channel: "C123" },
          timestamp: 1001,
        },
      }),
      ownerEmail: "dispatch+qa@integration.local",
      orgId: "org-qa",
      status: "processing",
      attempts: 1,
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
    };

    await processIntegrationTask(task, {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: task.ownerEmail,
    });

    expect(getOwnerActiveApiKeyMock).toHaveBeenCalledWith(task.ownerEmail);
    expect(resolveEngineMock).toHaveBeenCalledWith({
      engineOption: undefined,
      apiKey: "",
      model: "claude-sonnet-4-6",
    });
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: expect.objectContaining({ name: "builder" }),
        model: "claude-sonnet-4-6",
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "resolved builder claude-sonnet-4-6",
      }),
      expect.objectContaining({ externalThreadId: "thread-1" }),
      expect.objectContaining({ placeholderRef: undefined }),
    );
  });

  it("uses the explicit engine provider when resolving owner API keys", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn();
    getOwnerApiKeyMock.mockResolvedValue("openai-user-key");
    const task: PendingTask = {
      id: "task-openai",
      platform: "fake",
      externalEventKey: "fake:thread-2:1002",
      externalThreadId: "thread-2",
      payload: JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "thread-2",
          text: "hello from slack",
          senderName: "QA User",
          platformContext: { channel: "C123" },
          timestamp: 1002,
        },
      }),
      ownerEmail: "dispatch+qa@integration.local",
      orgId: "org-qa",
      status: "processing",
      attempts: 1,
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
    };

    await processIntegrationTask(task, {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "gpt-5.2",
      apiKey: "deploy-anthropic-key",
      engine: "ai-sdk:openai",
      ownerEmail: task.ownerEmail,
    });

    expect(getOwnerApiKeyMock).toHaveBeenCalledWith("openai", task.ownerEmail);
    expect(getOwnerActiveApiKeyMock).not.toHaveBeenCalled();
    expect(resolveEngineMock).toHaveBeenCalledWith({
      engineOption: "ai-sdk:openai",
      apiKey: "openai-user-key",
      model: "gpt-5.2",
    });
  });

  it("prefers stored model settings over the integration plugin default", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn();
    getStoredModelForEngineMock.mockResolvedValue("stored-builder-model");
    const task: PendingTask = {
      id: "task-model",
      platform: "fake",
      externalEventKey: "fake:thread-3:1003",
      externalThreadId: "thread-3",
      payload: JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "thread-3",
          text: "hello from slack",
          senderName: "QA User",
          platformContext: { channel: "C123" },
          timestamp: 1003,
        },
      }),
      ownerEmail: "dispatch+qa@integration.local",
      orgId: "org-qa",
      status: "processing",
      attempts: 1,
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
    };

    await processIntegrationTask(task, {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: task.ownerEmail,
    });

    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "stored-builder-model",
      }),
    );
  });
});
