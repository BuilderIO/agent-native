import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingTask } from "./pending-tasks-store.js";
import type { PlatformAdapter } from "./types.js";

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
const getConfiguredEngineNameForRequestMock = vi.hoisted(() => vi.fn());
const getStoredModelForEngineMock = vi.hoisted(() => vi.fn());
const isLocalDatabaseMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequestMock = vi.hoisted(() => vi.fn());
const listIntegrationUsageBudgetsMock = vi.hoisted(() => vi.fn());
const reserveIntegrationUsageBudgetMock = vi.hoisted(() => vi.fn());
const releaseIntegrationUsageBudgetMock = vi.hoisted(() => vi.fn());
const settleIntegrationUsageBudgetMock = vi.hoisted(() => vi.fn());
const setIntegrationAwaitingInputMock = vi.hoisted(() => vi.fn());
const clearIntegrationAwaitingInputMock = vi.hoisted(() => vi.fn());
const startRunMock = vi.hoisted(() => vi.fn());
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

// `filterInitialEngineTools`'s own filtering semantics are covered directly
// (unmocked) by production-agent.spec.ts. Re-implemented minimally here
// rather than via `vi.importActual` on the real module, which would pull in
// production-agent.ts's full module graph (e.g. its module-scope
// `registerBuiltinEngines()` call) and conflict with the narrower engine
// mock below. This only needs to prove webhook-handler.ts WIRES the filter
// with the right inputs, not re-prove the filter's own correctness.
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
  getOwnerActiveApiKey: getOwnerActiveApiKeyMock,
  getOwnerApiKey: getOwnerApiKeyMock,
  engineToProvider: (engineName: string) =>
    engineName.startsWith("ai-sdk:")
      ? engineName.slice("ai-sdk:".length)
      : engineName,
  actionsToEngineTools: actionsToEngineToolsMock,
  runAgentLoop: runAgentLoopMock,
  filterInitialEngineTools: fakeFilterInitialEngineTools,
}));

vi.mock("../agent/engine/index.js", () => ({
  getConfiguredEngineNameForRequest: getConfiguredEngineNameForRequestMock,
  getStoredModelForEngine: getStoredModelForEngineMock,
  normalizeModelForEngine: (
    engine: { defaultModel?: string },
    model: string | null | undefined,
  ) => model ?? engine.defaultModel,
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
  canUseDeployCredentialFallbackForRequest:
    canUseDeployCredentialFallbackForRequestMock,
  readDeployCredentialEnv: readDeployCredentialEnvMock,
}));

vi.mock("./usage-budget-store.js", () => ({
  integrationScopeSubjectKey: (scope: {
    platform: string;
    tenantId: string;
    conversationId: string;
  }) => JSON.stringify([scope.platform, scope.tenantId, scope.conversationId]),
  listIntegrationUsageBudgets: listIntegrationUsageBudgetsMock,
  reserveIntegrationUsageBudget: reserveIntegrationUsageBudgetMock,
  releaseIntegrationUsageBudget: releaseIntegrationUsageBudgetMock,
  settleIntegrationUsageBudget: settleIntegrationUsageBudgetMock,
}));

vi.mock("./awaiting-input-store.js", () => ({
  setIntegrationAwaitingInput: setIntegrationAwaitingInputMock,
  clearIntegrationAwaitingInput: clearIntegrationAwaitingInputMock,
}));

vi.mock("../usage/store.js", () => ({
  calculateCost: vi.fn(() => 25),
  recordUsage: vi.fn(),
}));

vi.mock("../agent/run-manager.js", () => ({
  startRun: startRunMock.mockImplementation(
    (runId, threadId, runFn, onComplete) => {
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
    },
  ),
}));

function createAdapter(
  sendResponse = vi.fn(async () => ({ status: "delivered" as const })),
  formatAgentResponse: PlatformAdapter["formatAgentResponse"] = (text) => ({
    text,
    platformContext: {},
  }),
): PlatformAdapter {
  return {
    platform: "fake",
    label: "Fake",
    getRequiredEnvKeys: () => [],
    handleVerification: async () => ({ handled: false }),
    verifyWebhook: async () => true,
    parseIncomingMessage: async () => null,
    sendResponse,
    formatAgentResponse,
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
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(true);
    actionsToEngineToolsMock.mockReturnValue([]);
    listIntegrationUsageBudgetsMock.mockResolvedValue([]);
    reserveIntegrationUsageBudgetMock.mockResolvedValue({
      allowed: true,
      status: "reserved",
    });
    releaseIntegrationUsageBudgetMock.mockResolvedValue({
      status: "released",
    });
    settleIntegrationUsageBudgetMock.mockResolvedValue({
      status: "settled",
    });
    setIntegrationAwaitingInputMock.mockResolvedValue(undefined);
    clearIntegrationAwaitingInputMock.mockResolvedValue(undefined);
    getStoredModelForEngineMock.mockResolvedValue(undefined);
    getConfiguredEngineNameForRequestMock.mockResolvedValue(undefined);
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
    vi.unstubAllEnvs();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  // CI runs this suite with a much longer transform/import phase than local
  // (~28s vs ~7s observed on 2026-05-11), which left the per-test 5s budget
  // too tight for the full processIntegrationTask pipeline. Bumping these two
  // mock-heavy run-loop tests to 15s avoids flake without masking real perf
  // regressions: the test bodies still finish in well under a second locally.
  it(
    "releases reserved budgets when thread setup fails",
    { timeout: 15_000 },
    async () => {
      const { processIntegrationTask } = await import("./webhook-handler.js");
      listIntegrationUsageBudgetsMock.mockResolvedValue([
        {
          id: "budget-org",
          subjectType: "org",
          subjectId: "org-qa",
        },
      ]);
      createThreadMock.mockRejectedValueOnce(new Error("thread setup failed"));

      await expect(
        processIntegrationTask(pendingTask(), {
          adapter: createAdapter(),
          systemPrompt: "system",
          actions: {},
          apiKey: "test-key",
          ownerEmail: "dispatch+qa@integration.local",
          orgId: "org-qa",
          principalType: "service",
        }),
      ).rejects.toThrow("thread setup failed");

      expect(reserveIntegrationUsageBudgetMock).toHaveBeenCalledOnce();
      expect(releaseIntegrationUsageBudgetMock).toHaveBeenCalledWith(
        expect.objectContaining({ budgetId: "budget-org" }),
        expect.objectContaining({ orgId: "org-qa" }),
      );
      expect(settleIntegrationUsageBudgetMock).not.toHaveBeenCalled();
    },
  );

  it(
    "settles the full actual cost above the reservation estimate",
    { timeout: 15_000 },
    async () => {
      const { processIntegrationTask } = await import("./webhook-handler.js");
      vi.stubEnv("INTEGRATION_RUN_RESERVATION_MICROS", "100");
      listIntegrationUsageBudgetsMock.mockResolvedValue([
        {
          id: "budget-org",
          subjectType: "org",
          subjectId: "org-qa",
        },
      ]);
      runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
        send({ type: "text", text: "done" });
        return {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          model: "test-model",
        };
      });

      await processIntegrationTask(pendingTask(), {
        adapter: createAdapter(),
        systemPrompt: "system",
        actions: {},
        apiKey: "test-key",
        ownerEmail: "dispatch+qa@integration.local",
        orgId: "org-qa",
        principalType: "service",
      });

      expect(startRunMock).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Function),
        expect.any(Function),
        { useHostedSoftTimeoutDefault: true },
      );
      expect(settleIntegrationUsageBudgetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          budgetId: "budget-org",
          actualCostMicros: 2_500,
        }),
        expect.anything(),
      );
    },
  );

  it(
    "uses the shared engine resolver instead of forcing Anthropic",
    { timeout: 15000 },
    async () => {
      const { processIntegrationTask } = await import("./webhook-handler.js");
      const sendResponse = vi.fn(async () => ({
        status: "delivered" as const,
      }));
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
            sourceUrl:
              "https://example-workspace.slack.com/archives/C123/p1001",
            routingHint: {
              targetAgent: "content",
              instruction: "Delegate structured intake to Content.",
            },
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
          maxOutputTokens: 32_000,
          reasoningEffort: "medium",
          systemPrompt: expect.stringContaining("<runtime-context>"),
        }),
      );
      const engineUserText =
        runAgentLoopMock.mock.calls[0]?.[0]?.messages?.[0]?.content?.[0]?.text;
      expect(engineUserText).toContain(
        "Source thread: https://example-workspace.slack.com/archives/C123/p1001",
      );
      expect(engineUserText).toContain("Required target agent: content");
      expect(engineUserText).toContain(
        "Routing instruction: Delegate structured intake to Content.",
      );
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "resolved builder claude-sonnet-4-6",
        }),
        expect.objectContaining({ externalThreadId: "thread-1" }),
        expect.objectContaining({ placeholderRef: undefined }),
      );
    },
  );

  it(
    "replays what participants saw with stable artifact identity on a follow-up",
    { timeout: 15_000 },
    async () => {
      const { processIntegrationTask } = await import("./webhook-handler.js");
      vi.stubEnv("APP_URL", "https://content.agent.test");
      const sendResponse = vi.fn(async () => ({
        status: "delivered" as const,
        messageRefs: ["provider-message-123"],
      }));
      const adapter = {
        ...createAdapter(sendResponse),
        formatAgentResponse: (text: string) => ({
          text: `[fake-rendered] ${text}`,
          platformContext: {},
        }),
      } satisfies PlatformAdapter;

      runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
        send({
          type: "tool_start",
          id: "form-call",
          tool: "submit-content-database-form",
          input: { databaseId: "design-asks" },
        });
        send({
          type: "tool_done",
          id: "form-call",
          tool: "submit-content-database-form",
          result: JSON.stringify({
            createdDocumentId: "request_123",
            createdDocumentTitle: "Is this thing on",
            urlPath: "/page/request_123",
            verification: { found: true },
            privateNoise: "do not replay this raw payload",
          }),
        });
        send({ type: "text", text: "Filed the design ask." });
      });

      await processIntegrationTask(pendingTask(), {
        adapter,
        systemPrompt: "system",
        actions: {},
        apiKey: "test-key",
        ownerEmail: "dispatch+qa@integration.local",
        orgId: "org-qa",
        principalType: "service",
      });

      const persistedData = updateThreadDataMock.mock.calls.at(-1)?.[1];
      expect(typeof persistedData).toBe("string");
      const persisted = JSON.parse(persistedData as string);
      const assistant = persisted.messages.at(-1);
      expect(assistant.metadata.integrationDelivery).toMatchObject({
        platform: "fake",
        status: "delivered",
        text: expect.stringContaining("[fake-rendered] Filed the design ask."),
        messageRefs: ["provider-message-123"],
      });
      expect(assistant.metadata.integrationDelivery.text).toContain(
        "https://content.agent.test/page/request_123",
      );
      expect(assistant.metadata.integrationArtifacts).toEqual([
        {
          resourceType: "document",
          id: "request_123",
          sourceAction: "submit-content-database-form",
          titleAtAction: "Is this thing on",
          url: "/page/request_123",
        },
      ]);
      expect(JSON.stringify(assistant.metadata)).not.toContain("privateNoise");

      getThreadMappingMock.mockResolvedValue({
        platform: "fake",
        externalThreadId: "thread-qa",
        internalThreadId: "thread-qa",
        platformContext: { channel: "C123" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      getThreadMock.mockResolvedValue({
        id: "thread-qa",
        threadData: persistedData,
      });
      let followUpMessages: any[] = [];
      runAgentLoopMock.mockImplementationOnce(async ({ messages, send }) => {
        followUpMessages = messages;
        send({ type: "text", text: "Updated the existing ask." });
      });

      await processIntegrationTask(
        pendingTask({
          id: "task-follow-up",
          externalEventKey: "fake:task-follow-up:1002",
          payload: JSON.stringify({
            incoming: {
              platform: "fake",
              externalThreadId: "thread-qa",
              text: "I meant assign it to Apoorva.",
              senderName: "QA User",
              senderEmail: "qa@example.test",
              platformContext: { channel: "C123" },
              timestamp: 1002,
            },
          }),
        }),
        {
          adapter,
          systemPrompt: "system",
          actions: {},
          apiKey: "test-key",
          ownerEmail: "dispatch+qa@integration.local",
          orgId: "org-qa",
          principalType: "service",
        },
      );

      const priorAssistantText = followUpMessages
        .find((message) => message.role === "assistant")
        ?.content?.find((part: any) => part.type === "text")?.text;
      expect(priorAssistantText).toContain("[fake-rendered]");
      expect(priorAssistantText).toContain("request_123");
      expect(priorAssistantText).toContain("IDs remain stable");
      expect(priorAssistantText).not.toContain(
        "do not replay this raw payload",
      );
    },
  );

  it(
    "does not persist participant-visible history without a delivery receipt",
    { timeout: 15_000 },
    async () => {
      const { processIntegrationTask } = await import("./webhook-handler.js");
      runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
        send({
          type: "tool_done",
          tool: "submit-content-database-form",
          result: JSON.stringify({
            createdDocumentId: "hidden_request",
            createdDocumentTitle: "Hidden request",
            urlPath: "/page/hidden_request",
            verification: { found: true },
          }),
        });
        send({ type: "text", text: "Created, but delivery failed." });
      });

      await processIntegrationTask(pendingTask(), {
        adapter: createAdapter(vi.fn(async () => undefined)),
        systemPrompt: "system",
        actions: {},
        apiKey: "test-key",
        ownerEmail: "dispatch+qa@integration.local",
        orgId: "org-qa",
        principalType: "service",
      });

      expect(updateThreadDataMock).not.toHaveBeenCalled();
    },
  );

  it(
    "uses the explicit engine provider when resolving owner API keys",
    { timeout: 15000 },
    async () => {
      const { processIntegrationTask } = await import("./webhook-handler.js");
      const sendResponse = vi.fn(async () => ({
        status: "delivered" as const,
      }));
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

      expect(getOwnerApiKeyMock).toHaveBeenCalledWith(
        "openai",
        task.ownerEmail,
      );
      expect(getOwnerActiveApiKeyMock).not.toHaveBeenCalled();
      expect(resolveEngineMock).toHaveBeenCalledWith({
        engineOption: "ai-sdk:openai",
        apiKey: "openai-user-key",
        model: "gpt-5.2",
      });
    },
  );

  it(
    "prefers the org's configured engine over the integration plugin default",
    { timeout: 15000 },
    async () => {
      const { processIntegrationTask } = await import("./webhook-handler.js");
      const { getRequestOrgId, getRequestUserEmail } =
        await import("../server/request-context.js");
      const sendResponse = vi.fn(async () => ({
        status: "delivered" as const,
      }));
      getConfiguredEngineNameForRequestMock.mockImplementationOnce(async () => {
        expect(getRequestUserEmail()).toBe("dispatch+qa@integration.local");
        expect(getRequestOrgId()).toBe("org-qa");
        return "anthropic";
      });
      getOwnerApiKeyMock.mockResolvedValue("anthropic-org-key");
      getStoredModelForEngineMock.mockResolvedValueOnce("claude-sonnet-4-6");
      resolveEngineMock.mockResolvedValueOnce({
        name: "anthropic",
        defaultModel: "claude-sonnet-4-6",
        stream: vi.fn(),
      });

      const task = pendingTask({
        id: "task-org-engine",
        ownerEmail: "dispatch+qa@integration.local",
        orgId: "org-qa",
      });

      await processIntegrationTask(task, {
        adapter: createAdapter(sendResponse),
        systemPrompt: "system",
        actions: {},
        model: "builder-default-model",
        apiKey: "",
        engine: "builder",
        appId: "dispatch",
        ownerEmail: task.ownerEmail,
      });

      expect(getConfiguredEngineNameForRequestMock).toHaveBeenCalledWith({
        appId: "dispatch",
      });
      expect(getOwnerApiKeyMock).toHaveBeenCalledWith(
        "anthropic",
        task.ownerEmail,
      );
      expect(resolveEngineMock).toHaveBeenCalledWith({
        engineOption: "anthropic",
        apiKey: "anthropic-org-key",
        model: "builder-default-model",
        appId: "dispatch",
      });
      expect(runAgentLoopMock).toHaveBeenCalledWith(
        expect.objectContaining({
          engine: expect.objectContaining({ name: "anthropic" }),
          model: "claude-sonnet-4-6",
        }),
      );
    },
  );

  it("sanitizes missing LLM credential text before sending platform replies", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
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
    expect(sentText).toContain("Agent settings > LLM");
    expect(sentText).not.toContain("ANTHROPIC_API_KEY");
  });

  it("uses the explicit provider env key when no owner key exists in single-tenant mode", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
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

  it("does not fall back to deployment LLM keys in production shared mode", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    process.env.NODE_ENV = "production";
    isLocalDatabaseMock.mockReturnValue(false);
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    readDeployCredentialEnvMock.mockImplementation((key: string) =>
      key === "OPENAI_API_KEY" ? "openai-hosted-key" : undefined,
    );
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

    expect(readDeployCredentialEnvMock).not.toHaveBeenCalledWith(
      "OPENAI_API_KEY",
    );
    expect(resolveEngineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engineOption: "ai-sdk:openai",
        apiKey: undefined,
      }),
    );
  });

  it("prefers stored model settings over the integration plugin default", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
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
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
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
        principalType: "service",
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
      attempts: 2,
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
        attempts: 2,
        placeholderRef: "placeholder-qa",
        principalType: "service",
        incoming: expect.objectContaining({
          platform: "fake",
          externalThreadId: "thread-4",
        }),
      }),
    );
  });

  it("aliases legacy external thread mappings to the canonical id", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const task = pendingTask({
      id: "task-legacy-thread",
      platform: "telegram",
      externalThreadId: "chat:555:thread:99",
      payload: JSON.stringify({
        incoming: {
          platform: "telegram",
          externalThreadId: "chat:555:thread:99",
          text: "continue this conversation",
          senderId: "777",
          threadRef: "99",
          platformContext: { chatId: 555, messageThreadId: 99 },
          timestamp: 1008,
        },
      }),
    });
    getThreadMappingMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      platform: "telegram",
      externalThreadId: "555",
      internalThreadId: "thread-existing",
      platformContext: { chatId: 555 },
      createdAt: 1,
      updatedAt: 2,
    });
    const adapter = {
      ...createAdapter(),
      platform: "telegram",
      getLegacyExternalThreadIds: () => ["555"],
    };

    await processIntegrationTask(task, {
      adapter,
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: task.ownerEmail,
    });

    expect(getThreadMappingMock).toHaveBeenNthCalledWith(
      1,
      "telegram",
      "chat:555:thread:99",
    );
    expect(getThreadMappingMock).toHaveBeenNthCalledWith(2, "telegram", "555");
    expect(saveThreadMappingMock).toHaveBeenCalledWith(
      "telegram",
      "chat:555:thread:99",
      "thread-existing",
      expect.objectContaining({ chatId: 555, messageThreadId: 99 }),
    );
    expect(createThreadMock).not.toHaveBeenCalled();
  });

  it("reruns the agent loop when a previously queued continuation task is retried", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const task = pendingTask({ id: "task-retry-existing-continuation" });
    runAgentLoopMock
      .mockImplementationOnce(async ({ send }) => {
        send({
          type: "tool_start",
          tool: "call-agent",
          input: { agent: "starter", message: "finish the setup" },
        });
        send({
          type: "tool_done",
          tool: "call-agent",
          result: `${A2A_CONTINUATION_QUEUED_MARKER}\nThe Starter agent is still working.`,
        });
      })
      .mockImplementationOnce(async ({ send }) => {
        send({
          type: "text",
          text: "Recovered final answer after the retry.",
        });
      });

    await processIntegrationTask(task, {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });
    await processIntegrationTask(task, {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });

    expect(runAgentLoopMock).toHaveBeenCalledTimes(2);
    expect(sendResponse).toHaveBeenCalledTimes(1);
    expect(sendResponse.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        text: "Recovered final answer after the retry.",
      }),
    );
  });

  it("suppresses stale A2A continuation deferral replies", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
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

  it("keeps a resumable native progress stream open for a queued A2A continuation", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const onEvent = vi.fn(async () => undefined);
    const complete = vi.fn(async () => undefined);
    const adapter = {
      ...createAdapter(sendResponse),
      startRunProgress: async () => ({
        ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
        onEvent,
        complete,
      }),
    };
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({ type: "agent_call", agent: "Design", status: "start" });
      send({
        type: "tool_done",
        tool: "call-agent",
        result: `${A2A_CONTINUATION_QUEUED_MARKER}\nThe Design agent is still working.`,
      });
    });

    await processIntegrationTask(
      pendingTask({ id: "task-stream-continuation" }),
      {
        adapter,
        systemPrompt: "system",
        actions: {},
        model: "claude-sonnet-4-6",
        apiKey: "",
        ownerEmail: "dispatch+qa@integration.local",
      },
    );

    expect(complete).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent_call_progress",
        agent: "Design",
        state: "working",
      }),
    );
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("does not falsely fail a queued resumable stream when parent bookkeeping throws", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const fail = vi.fn(async () => undefined);
    const adapter = {
      ...createAdapter(sendResponse),
      startRunProgress: async () => ({
        ref: { kind: "slack-stream", streamTs: "1719000000.000001" },
        onEvent: vi.fn(async () => undefined),
        complete: vi.fn(async () => undefined),
        fail,
      }),
    };
    updateThreadDataMock.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_done",
        tool: "call-agent",
        result: `${A2A_CONTINUATION_QUEUED_MARKER}\nThe Design agent is still working.`,
      });
    });

    await processIntegrationTask(
      pendingTask({ id: "task-stream-continuation-bookkeeping" }),
      {
        adapter,
        systemPrompt: "system",
        actions: {},
        model: "claude-sonnet-4-6",
        apiKey: "",
        ownerEmail: "dispatch+qa@integration.local",
      },
    );

    expect(fail).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("projects a successful Slack ask-question call into a reply window", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const slackIncoming = {
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      text: "Create a launch design task",
      senderId: "U123",
      tenantId: "T123",
      platformContext: {
        apiAppId: "A123",
        teamId: "T123",
        channelId: "C123",
        threadTs: "111.222",
      },
      timestamp: 1,
    };
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_start",
        tool: "ask-question",
        input: {
          header: "Audience",
          question: "Who is the launch page for?",
          options: JSON.stringify([
            {
              label: "Existing customers",
              description: "Focus on adoption and expansion",
              recommended: true,
            },
            {
              label: "New prospects",
              description: "Focus on discovery and conversion",
            },
          ]),
          allowFreeText: "true",
        },
      });
      send({
        type: "tool_done",
        tool: "ask-question",
        result:
          "Asked the user a clarifying question and rendered it in the chat. Stop here and wait for their answer — do not proceed or assume an answer.",
      });
    });
    const task = pendingTask({
      platform: "slack",
      externalThreadId: slackIncoming.externalThreadId,
      payload: JSON.stringify({ incoming: slackIncoming }),
    });

    await processIntegrationTask(task, {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: task.ownerEmail,
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Who is the launch page for?"),
      }),
      expect.objectContaining({
        externalThreadId: slackIncoming.externalThreadId,
      }),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0]?.[0].text).toContain(
      "1. Existing customers — Focus on adoption and expansion",
    );
    expect(setIntegrationAwaitingInputMock).toHaveBeenCalledWith({
      platform: "slack",
      externalThreadId: slackIncoming.externalThreadId,
      requesterId: "U123",
    });
    expect(clearIntegrationAwaitingInputMock).not.toHaveBeenCalled();
  });

  it("clears a Slack reply window after a terminal response", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const slackIncoming = {
      platform: "slack",
      externalThreadId: "A123:T123:C123:111.222",
      text: "Use existing customers",
      senderId: "U123",
      tenantId: "T123",
      platformContext: {
        apiAppId: "A123",
        teamId: "T123",
        channelId: "C123",
        threadTs: "111.222",
      },
      timestamp: 1,
    };
    const task = pendingTask({
      platform: "slack",
      externalThreadId: slackIncoming.externalThreadId,
      payload: JSON.stringify({ incoming: slackIncoming }),
    });

    await processIntegrationTask(task, {
      adapter: createAdapter(),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: task.ownerEmail,
    });

    expect(clearIntegrationAwaitingInputMock).toHaveBeenCalledWith(
      "slack",
      slackIncoming.externalThreadId,
    );
  });

  it("suppresses alternate A2A continuation deferral wording", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
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

  it("sends real parent text without closing a queued continuation's native progress stream", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const onEvent = vi.fn(async () => undefined);
    const complete = vi.fn(async () => undefined);
    const adapter = {
      ...createAdapter(sendResponse),
      startRunProgress: async () => ({
        ref: { kind: "slack-stream", streamTs: "1719000000.000002" },
        onEvent,
        complete,
      }),
    };
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
      adapter,
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });

    expect(complete).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "371 pageview events were recorded in the requested window.",
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(
      onEvent.mock.calls.some(
        ([event]) => event.type === "agent_call_progress",
      ),
    ).toBe(false);
  });

  it("sends substantive partial answers without closing a queued continuation stream", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const { A2A_CONTINUATION_QUEUED_MARKER } =
      await import("./a2a-continuation-marker.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const complete = vi.fn(async () => undefined);
    const adapter = {
      ...createAdapter(sendResponse),
      startRunProgress: async () => ({
        ref: { kind: "slack-stream", streamTs: "1719000000.000003" },
        onEvent: vi.fn(async () => undefined),
        complete,
      }),
    };
    const partialAnswer =
      "Analytics completed: 259,850 page views and 9,337 unique visitors from BigQuery. " +
      "Content page was created successfully with document id abc123. " +
      "Slides will post its result separately.";
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_start",
        tool: "call-agent",
        input: { agent: "slides", message: "create deck" },
      });
      send({
        type: "tool_done",
        tool: "call-agent",
        result: `${A2A_CONTINUATION_QUEUED_MARKER}\nThe Slides agent accepted this delegated subtask and will post its own final result.`,
      });
      send({
        type: "text",
        text: partialAnswer,
      });
    });

    await processIntegrationTask(pendingTask({ id: "task-partial-final" }), {
      adapter,
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });

    expect(complete).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ text: partialAnswer }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
  });

  it("sends verified recoverable A2A artifact tool results when no final text is emitted", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_start",
        tool: "call-agent",
        input: { agent: "slides", message: "make a launch deck" },
      });
      send({
        type: "tool_done",
        tool: "call-agent",
        result:
          "The agent is still working on the full response, but these verified artifacts already exist:\n\n" +
          "Artifacts:\n" +
          "- Deck: https://slides.agent.test/deck/deck-real (ID: deck-real)",
      });
    });

    await processIntegrationTask(pendingTask({ id: "task-recoverable-a2a" }), {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "https://slides.agent.test/deck/deck-real",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
  });

  it("guards recoverable A2A artifact fallbacks before sending Slack-style replies", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const previousAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://dispatch.agent-native.com";
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_start",
        tool: "call-agent",
        input: { agent: "design", message: "make a launch card" },
      });
      send({
        type: "tool_done",
        tool: "call-agent",
        result:
          "The agent is still working on the full response, but these verified artifacts already exist:\n\n" +
          "Artifacts:\n" +
          "- Design: https://design.agent-native.com/design/design-empty (ID: design-empty, 0 files)",
      });
    });

    try {
      await processIntegrationTask(
        pendingTask({ id: "task-recoverable-a2a-empty-design" }),
        {
          adapter: createAdapter(sendResponse),
          systemPrompt: "system",
          actions: {},
          model: "claude-sonnet-4-6",
          apiKey: "",
          ownerEmail: "dispatch+qa@integration.local",
        },
      );
    } finally {
      if (previousAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = previousAppUrl;
      }
    }

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("could not verify the design URL"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain("design-empty");
  });

  it("surfaces a useful fallback when no final text is emitted", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_start",
        tool: "call-agent",
        input: { agent: "slides", message: "make a launch deck" },
      });
      send({
        type: "tool_done",
        tool: "call-agent",
        result: "Maybe try https://slides.agent.test/deck/deck-guessed",
      });
    });

    await processIntegrationTask(pendingTask({ id: "task-unmarked-a2a" }), {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "claude-sonnet-4-6",
      apiKey: "",
      ownerEmail: "dispatch+qa@integration.local",
    });

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "The model finished without a visible answer",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain("deck-guessed");
  });

  it("links Slack-style replies directly to the Dispatch chat thread", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const previousAppUrl = process.env.APP_URL;
    const previousAppBasePath = process.env.APP_BASE_PATH;
    process.env.APP_URL = "https://agent-workspace.builder.io";
    process.env.APP_BASE_PATH = "/dispatch";
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    const formatAgentResponse = vi.fn(
      (text: string, opts?: { threadDeepLinkUrl?: string }) => ({
        text,
        platformContext: opts ?? {},
      }),
    );
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({ type: "text", text: "I found the issue." });
    });

    try {
      await processIntegrationTask(pendingTask({ id: "task-direct-thread" }), {
        adapter: createAdapter(sendResponse, formatAgentResponse),
        systemPrompt: "system",
        actions: {},
        model: "claude-sonnet-4-6",
        apiKey: "",
        ownerEmail: "dispatch+qa@integration.local",
      });
    } finally {
      if (previousAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = previousAppUrl;
      }
      if (previousAppBasePath === undefined) {
        delete process.env.APP_BASE_PATH;
      } else {
        process.env.APP_BASE_PATH = previousAppBasePath;
      }
    }

    expect(formatAgentResponse).toHaveBeenCalledWith("I found the issue.", {
      threadDeepLinkUrl:
        "https://agent-workspace.builder.io/dispatch/chat/thread-qa",
    });
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ text: "I found the issue." }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
  });

  it("does not send hallucinated local design URLs to Slack-style integrations", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const previousAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://design.agent.test";
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "text",
        text: "Done: https://design.agent.test/design/DSyLeIdyBc9p_drm40Tfp",
      });
    });

    try {
      await processIntegrationTask(pendingTask({ id: "task-false-design" }), {
        adapter: createAdapter(sendResponse),
        systemPrompt: "system",
        actions: {},
        model: "claude-sonnet-4-6",
        apiKey: "",
        ownerEmail: "dispatch+qa@integration.local",
      });
    } finally {
      if (previousAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = previousAppUrl;
      }
    }

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("could not verify the design URL"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain(
      "DSyLeIdyBc9p_drm40Tfp",
    );
  });

  it("does not relay unverified production Design URLs from Dispatch Slack replies", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const previousAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://dispatch.agent-native.com";
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "text",
        text: "The Design agent returned https://design.agent-native.com/design/us1sfMEZNWUQZHDldxoFA",
      });
    });

    try {
      await processIntegrationTask(
        pendingTask({ id: "task-cross-app-false-design" }),
        {
          adapter: createAdapter(sendResponse),
          systemPrompt: "system",
          actions: {},
          model: "claude-sonnet-4-6",
          apiKey: "",
          ownerEmail: "dispatch+qa@integration.local",
        },
      );
    } finally {
      if (previousAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = previousAppUrl;
      }
    }

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("could not verify the design URL"),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
    expect(sendResponse.mock.calls[0][0].text).toContain("saved app data");
    expect(sendResponse.mock.calls[0][0].text).not.toContain(
      "us1sfMEZNWUQZHDldxoFA",
    );
    expect(sendResponse.mock.calls[0][0].text).not.toContain(
      "https://design.agent-native.com/design/",
    );
  });

  it("adds real design URLs to Slack-style integration replies after generate-design succeeds", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    const previousAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://design.agent.test";
    const sendResponse = vi.fn(async () => ({ status: "delivered" as const }));
    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({
        type: "tool_done",
        tool: "create-design",
        result: JSON.stringify({ id: "design_123", title: "Prototype" }),
      });
      send({
        type: "tool_done",
        tool: "generate-design",
        result: JSON.stringify({
          designId: "design_123",
          savedFiles: [{ id: "file_1", filename: "index.html" }],
          fileCount: 1,
        }),
      });
      send({ type: "text", text: "The prototype is ready." });
    });

    try {
      await processIntegrationTask(pendingTask({ id: "task-real-design" }), {
        adapter: createAdapter(sendResponse),
        systemPrompt: "system",
        actions: {},
        model: "claude-sonnet-4-6",
        apiKey: "",
        ownerEmail: "dispatch+qa@integration.local",
      });
    } finally {
      if (previousAppUrl === undefined) {
        delete process.env.APP_URL;
      } else {
        process.env.APP_URL = previousAppUrl;
      }
    }

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          "https://design.agent.test/design/design_123",
        ),
      }),
      expect.any(Object),
      expect.objectContaining({ placeholderRef: undefined }),
    );
  });

  it("defers framework-added tools behind tool-search on the first engine request while keeping template actions and initial defaults", async () => {
    const { processIntegrationTask } = await import("./webhook-handler.js");
    // Only this test needs a real-shaped action->tool conversion — every
    // other test in this file relies on the `[]` stub set in `beforeEach`
    // and doesn't inspect `tools`/`availableTools`.
    actionsToEngineToolsMock.mockImplementation(
      (actionsMap: Record<string, { tool: { description: string } }>) =>
        Object.keys(actionsMap).map((name) => ({
          name,
          description: actionsMap[name].tool.description,
          inputSchema: { type: "object", properties: {} },
        })),
    );

    runAgentLoopMock.mockImplementationOnce(async ({ send }) => {
      send({ type: "text", text: "ok" });
    });

    const noopTool = (description: string) => ({
      tool: {
        description,
        parameters: { type: "object" as const, properties: {} },
      },
      run: async () => "ok",
    });

    await processIntegrationTask(pendingTask({ id: "task-tool-filter" }), {
      adapter: createAdapter(),
      systemPrompt: "system",
      actions: {
        "template-action": noopTool("A template/app action"),
        "call-agent": noopTool("Delegate to another A2A agent"),
        "list-integration-memory": noopTool("List integration memory"),
      },
      // Mirrors what `createIntegrationsPlugin` passes: the app's own
      // action names, not the framework additions merged into `actions`.
      initialToolNames: ["template-action"],
      apiKey: "test-key",
      ownerEmail: "dispatch+qa@integration.local",
      orgId: "org-qa",
      principalType: "service",
    });

    expect(runAgentLoopMock).toHaveBeenCalledOnce();
    const call = runAgentLoopMock.mock.calls[0]?.[0];
    const firstRequestToolNames: string[] = call.tools
      .map((tool: { name: string }) => tool.name)
      .sort();
    const availableToolNames: string[] = call.availableTools
      .map((tool: { name: string }) => tool.name)
      .sort();

    // Deferred framework additions never reach the first request...
    expect(firstRequestToolNames).not.toContain("call-agent");
    expect(firstRequestToolNames).not.toContain("list-integration-memory");
    // ...but the template action, and tool-search itself, do.
    expect(firstRequestToolNames).toEqual(["template-action", "tool-search"]);
    // ...while the full registry (used for mid-run tool-search expansion)
    // still contains everything, so the model can discover and call the
    // deferred tools after a tool-search hit.
    expect(availableToolNames).toEqual([
      "call-agent",
      "list-integration-memory",
      "template-action",
      "tool-search",
    ]);
    // The executable registry passed through for real tool dispatch must
    // also include tool-search so a model-issued call to it can run.
    expect(Object.keys(call.actions).sort()).toEqual([
      "call-agent",
      "list-integration-memory",
      "template-action",
      "tool-search",
    ]);
  });
});
