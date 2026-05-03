import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const isLocalDatabaseMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const originalNodeEnv = process.env.NODE_ENV;

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

vi.mock("../db/client.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/client.js")>("../db/client.js");
  return {
    ...actual,
    isLocalDatabase: isLocalDatabaseMock,
  };
});

vi.mock("../server/credential-provider.js", () => ({
  readDeployCredentialEnv: readDeployCredentialEnvMock,
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

function pendingTask(
  overrides: Partial<PendingTask> & { payload?: PendingTask["payload"] } = {},
): PendingTask {
  const id = overrides.id ?? "task-qa";
  return {
    id,
    platform: "fake",
    externalEventKey: `fake:${id}:1001`,
    externalThreadId: "thread-qa",
    payload:
      overrides.payload ??
      JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "thread-qa",
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
    ...overrides,
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
    isLocalDatabaseMock.mockReturnValue(true);
    readDeployCredentialEnvMock.mockReturnValue(undefined);
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

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
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
      apiKey: undefined,
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

  it("sanitizes missing LLM credential text before sending platform replies", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn();
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({ type: "text", text: "ANTHROPIC_API_KEY is not set" });
    });
    const task: PendingTask = {
      id: "task-missing-llm",
      platform: "fake",
      externalEventKey: "fake:thread-missing-llm:1007",
      externalThreadId: "thread-missing-llm",
      payload: JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "thread-missing-llm",
          text: "hello from slack",
          senderName: "QA User",
          platformContext: { channel: "C123" },
          timestamp: 1007,
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

    const sentText = vi.mocked(sendResponse).mock.calls[0]?.[0].text ?? "";
    expect(sentText).toContain("Connect an LLM provider or Builder");
    expect(sentText).not.toContain("ANTHROPIC_API_KEY");
  });

  it("uses the explicit provider env key when no owner key exists in single-tenant mode", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn();
    readDeployCredentialEnvMock.mockImplementation((key: string) =>
      key === "OPENAI_API_KEY" ? "openai-env-key" : undefined,
    );
    const task: PendingTask = {
      id: "task-openai-env",
      platform: "fake",
      externalEventKey: "fake:thread-env:1005",
      externalThreadId: "thread-env",
      payload: JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "thread-env",
          text: "hello from slack",
          senderName: "QA User",
          platformContext: { channel: "C123" },
          timestamp: 1005,
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
      apiKey: "",
      engine: "ai-sdk:openai",
      ownerEmail: task.ownerEmail,
    });

    expect(readDeployCredentialEnvMock).toHaveBeenCalledWith("OPENAI_API_KEY");
    expect(resolveEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engineOption: "ai-sdk:openai",
        apiKey: "openai-env-key",
      }),
    );
  });

  it("does not fall back to deployment keys in multi-tenant mode", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn();
    process.env.NODE_ENV = "production";
    isLocalDatabaseMock.mockReturnValue(false);
    const task: PendingTask = {
      id: "task-multitenant",
      platform: "fake",
      externalEventKey: "fake:thread-mt:1006",
      externalThreadId: "thread-mt",
      payload: JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "thread-mt",
          text: "hello from slack",
          senderName: "QA User",
          platformContext: { channel: "C123" },
          timestamp: 1006,
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
      apiKey: "deploy-key",
      engine: "ai-sdk:openai",
      ownerEmail: task.ownerEmail,
    });

    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
    expect(resolveEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engineOption: "ai-sdk:openai",
        apiKey: undefined,
      }),
    );
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

  it("exposes integration task context while running tools", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { getIntegrationRequestContext } =
      await import("../server/request-context.js");
    const sendResponse = vi.fn();
    let captured: ReturnType<typeof getIntegrationRequestContext>;
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      captured = getIntegrationRequestContext();
      send({ type: "text", text: "ok" });
    });
    const task: PendingTask = {
      id: "task-context",
      platform: "fake",
      externalEventKey: "fake:thread-4:1004",
      externalThreadId: "thread-4",
      payload: JSON.stringify({
        placeholderRef: "placeholder-qa",
        incoming: {
          platform: "fake",
          externalThreadId: "thread-4",
          text: "hello from slack",
          senderName: "QA User",
          platformContext: { channel: "C123" },
          timestamp: 1004,
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

    expect(captured).toEqual(
      expect.objectContaining({
        taskId: "task-context",
        placeholderRef: "placeholder-qa",
        incoming: expect.objectContaining({
          platform: "fake",
          externalThreadId: "thread-4",
        }),
      }),
    );
  });

  it("suppresses stale A2A continuation deferral replies", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn();
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_start",
        tool: "call-agent",
        input: { agent: "analytics", message: "count pageviews" },
      });
      send({
        type: "tool_done",
        tool: "call-agent",
        result: `${A2A_CONTINUATION_QUEUED_MARKER}\nThe Analytics agent is still working.`,
      });
      send({
        type: "text",
        text: "Here is the relay from the Analytics agent. It is still processing and will post the result back to this thread when complete.",
      });
    });

    await processIntegrationTask(pendingTask({ id: "task-continuation" }), {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });

    expect(sendResponse).not.toHaveBeenCalled();
    expect(updateThreadDataMock).toHaveBeenCalled();
  });

  it("suppresses alternate A2A continuation deferral wording", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn();
    const deferrals = [
      "",
      A2A_CONTINUATION_QUEUED_MARKER,
      "The Analytics answer will show up here shortly.",
      "I will relay from the Analytics agent when the result is ready.",
      "The Slides agent is working on your *Launch Readiness Snapshot* deck (title, risks, next steps). The result will be posted here in this thread as soon as it's ready - hang tight!",
      "The Design agent is working on your *Launch Readiness Status Card* - it'll post the artifact URL directly here in this thread as soon as it's ready. Hang tight! :art:",
    ];

    for (const [index, text] of deferrals.entries()) {
      runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
        send({
          type: "tool_start",
          tool: "call-agent",
          input: { agent: "analytics", message: "count pageviews" },
        });
        send({
          type: "tool_done",
          tool: "call-agent",
          result: `${A2A_CONTINUATION_QUEUED_MARKER}\nThe Analytics agent is still working.`,
        });
        if (text) {
          send({
            type: "text",
            text,
          });
        }
      });

      await processIntegrationTask(
        pendingTask({ id: `task-continuation-wording-${index}` }),
        {
          adapter: createAdapter(sendResponse),
          systemPrompt: "system",
          actions: {},
          model: "claude-sonnet-4-6",
          apiKey: "",
          ownerEmail: "dispatch+qa@integration.local",
        },
      );
    }

    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("still sends real final text after an A2A continuation marker", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn();
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_start",
        tool: "call-agent",
        input: { agent: "analytics", message: "count pageviews" },
      });
      send({
        type: "tool_done",
        tool: "call-agent",
        result: `${A2A_CONTINUATION_QUEUED_MARKER}\nThe Analytics agent is still working.`,
      });
      send({
        type: "text",
        text: "371 pageview events were recorded in the requested window.",
      });
    });

    await processIntegrationTask(pendingTask({ id: "task-final" }), {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "371 pageview events were recorded in the requested window.",
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
  });
});
