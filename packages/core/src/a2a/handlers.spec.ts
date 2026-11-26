import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { isProviderInteractiveScope } from "../provider-api/interactive-scope.js";
import {
  getRequestOrgId,
  getRequestContext,
  getRequestUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import { renderMachineTrace } from "../state-machine/index.js";
import {
  registerTrackingProvider,
  unregisterTrackingProvider,
} from "../tracking/registry.js";
import {
  A2A_CALL_REFUSED_KIND,
  clearA2AActionCallHooksForTests,
  registerA2AActionCallHook,
} from "./call-hooks.js";
import { isA2AForegroundCall } from "./foreground-call-scope.js";
import { handleJsonRpcH3 as handleJsonRpc } from "./handlers.js";
import { a2aTaskMachine } from "./task-lifecycle.js";
import type { A2AConfig, Message } from "./types.js";

const resolveOrgByDomainMock = vi.hoisted(() => vi.fn());
const resolveA2AOrganizationCredentialsByDomainMock = vi.hoisted(() => vi.fn());
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn());
const getA2ASecretByDomainMock = vi.hoisted(() => vi.fn());
const callActionMock = vi.hoisted(() => vi.fn());
const findWorkspaceDispatchAgentMock = vi.hoisted(() => vi.fn());
const uploadFileMock = vi.hoisted(() => vi.fn());
const claimTaskExecutionLeaseMock = vi.hoisted(() =>
  vi.fn(async (threadId: string, turnId: string, runId: string) => ({
    threadId,
    turnId,
    runId,
    generation: "1",
  })),
);
const renewTaskExecutionLeaseMock = vi.hoisted(() => vi.fn(async () => {}));
const releaseTurnExecutionLeaseMock = vi.hoisted(() => vi.fn(async () => {}));

const chatTurn = vi.hoisted(() => ({
  admit: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({ status: "absent" }),
  ),
  read: vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({
      status: "absent",
    }),
  ),
}));
vi.mock("../mcp/chat-turn-store.js", () => ({
  MCP_CHAT_TURN_FIELD: "__agentNativeMcpChatTurn",
  admitMcpChatTurn: chatTurn.admit,
  readMcpChatTurn: chatTurn.read,
}));

vi.mock("../agent/run-store.js", () => ({
  claimTaskExecutionLease: claimTaskExecutionLeaseMock,
  renewTaskExecutionLease: renewTaskExecutionLeaseMock,
  releaseTurnExecutionLease: releaseTurnExecutionLeaseMock,
  TURN_EXECUTION_LEASE_MS: 15_000,
}));

vi.mock("h3", () => ({
  getHeader: (event: any, name: string) =>
    event.req?.headers?.get?.(name) ?? event.node?.req?.headers?.[name],
  setResponseStatus: (event: any, code: number) => {
    event._status = code;
  },
  setResponseHeader: (event: any, key: string, val: string) => {
    event._headers[key] = val;
  },
}));

vi.mock("./task-store.js", () => {
  let tasks: Record<string, any> = {};
  let counter = 0;
  const createTask = async (
    message: Message,
    contextId?: string,
    metadata?: Record<string, unknown>,
    ownerEmail?: string | null,
    ownerScope?: string | null,
  ) => {
    const id = `task-${++counter}`;
    const task = {
      id,
      contextId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [message],
      artifacts: [],
      metadata,
      ownerEmail: ownerEmail ?? null,
      ownerScope: ownerScope ?? null,
      idempotencyKey: undefined as string | undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    tasks[id] = task;
    return task;
  };
  class A2ATaskCanceledError extends Error {
    readonly task: unknown;
    constructor(task: unknown) {
      super("A2A task was canceled");
      this.name = "A2ATaskCanceledError";
      this.task = task;
    }
  }
  return {
    A2ATaskCanceledError,
    A2A_TASK_CLAIM_LOST_ERROR_CODE: "a2a_task_claim_lost",
    A2A_PERSONAL_OWNER_SCOPE: "__personal__",
    A2A_ORG_ID_OWNER_SCOPE_PREFIX: "__a2a_org_id__:",
    MAX_A2A_IDEMPOTENCY_KEY_CHARS: 128,
    a2aTaskLeaseThreadId: (taskId: string) => `a2a-task:${taskId}`,
    a2aTaskLeaseThreadId: (taskId: string) => `a2a-task:${taskId}`,
    createTask,
    async createOrReuseTask(
      message: Message,
      contextId?: string,
      metadata?: Record<string, unknown>,
      ownerEmail?: string | null,
      ownerScope?: string | null,
      idempotencyKey?: string,
    ) {
      if (ownerScope && idempotencyKey) {
        const existing = Object.values(tasks).find(
          (task) =>
            (task.ownerEmail?.toLowerCase() ?? null) ===
              (ownerEmail?.toLowerCase() ?? null) &&
            task.ownerScope === ownerScope &&
            task.idempotencyKey === idempotencyKey,
        );
        if (existing) return { task: existing, reused: true };
      }
      const task = await createTask(
        message,
        contextId,
        metadata,
        ownerEmail,
        ownerScope,
      );
      task.idempotencyKey = idempotencyKey;
      return { task, reused: false };
    },
    async getIdempotentTask(
      ownerEmail: string,
      ownerScope: string,
      idempotencyKey: string,
    ) {
      return (
        Object.values(tasks).find(
          (task) =>
            task.ownerEmail?.toLowerCase() === ownerEmail.toLowerCase() &&
            task.ownerScope === ownerScope &&
            task.idempotencyKey === idempotencyKey,
        ) ?? null
      );
    },
    async getTask(id: string, accessScope?: any) {
      const task = tasks[id];
      if (
        !task ||
        (accessScope &&
          (task.ownerEmail?.toLowerCase() !==
            accessScope.ownerEmail.toLowerCase() ||
            (task.ownerScope ?? "").toLowerCase() !==
              (accessScope.ownerScope ?? "").toLowerCase()))
      )
        return null;
      return task;
    },
    async getTaskOwnership(id: string) {
      const task = tasks[id];
      return {
        ownerEmail: task?.ownerEmail ?? null,
        ownerScope: task?.ownerScope ?? null,
      };
    },
    async setTaskOwnerScope(id: string, ownerScope: string | null) {
      if (tasks[id]) tasks[id].ownerScope = ownerScope;
    },
    async updateTask(id: string, update: any, accessScope?: any) {
      const task = tasks[id];
      if (
        !task ||
        (accessScope &&
          (task.ownerEmail?.toLowerCase() !==
            accessScope.ownerEmail.toLowerCase() ||
            (task.ownerScope ?? "").toLowerCase() !==
              (accessScope.ownerScope ?? "").toLowerCase()))
      )
        return null;
      if (task.status.state === "canceled") {
        throw new A2ATaskCanceledError(task);
      }
      if (update.state) {
        task.status = {
          state: update.state,
          message: update.message ?? task.status.message,
          timestamp: new Date().toISOString(),
        };
        task.updatedAt = Date.now();
      }
      if (update.message && task.history) {
        task.history.push(update.message);
      }
      if (update.artifacts) {
        task.artifacts = [...(task.artifacts ?? []), ...update.artifacts];
      }
      return task;
    },
    async cancelA2ATask(id: string, accessScope?: any) {
      const task = tasks[id];
      if (
        !task ||
        (accessScope &&
          (task.ownerEmail?.toLowerCase() !==
            accessScope.ownerEmail.toLowerCase() ||
            (task.ownerScope ?? "").toLowerCase() !==
              (accessScope.ownerScope ?? "").toLowerCase()))
      )
        return { status: "not_found" };
      if (["completed", "failed", "canceled"].includes(task.status.state))
        return { status: "not_cancelable", state: task.status.state };
      task.status = {
        state: "canceled",
        message: task.status.message,
        timestamp: new Date().toISOString(),
      };
      task.updatedAt = Date.now();
      return { status: "canceled", task };
    },
    async settleProcessingA2ATask(id: string, update: any) {
      const task = tasks[id];
      if (!task || task.status.state !== "processing") return null;
      task.status = {
        state: update.state,
        message: update.message ?? task.status.message,
        timestamp: new Date().toISOString(),
      };
      task.updatedAt = Date.now();
      if (update.message && task.history) {
        task.history.push(update.message);
      }
      if (update.artifacts) {
        task.artifacts = [...(task.artifacts ?? []), ...update.artifacts];
      }
      return task;
    },
    async claimA2ATaskForProcessing(id: string) {
      const task = tasks[id];
      if (!task) return null;
      if (!["submitted", "working"].includes(task.status.state)) return null;
      task.status = {
        state: "processing",
        message: task.status.message,
        timestamp: new Date().toISOString(),
      };
      task.updatedAt = Date.now();
      return task;
    },
    async getA2ATaskDispatchState(id: string) {
      const task = tasks[id];
      if (!task) return null;
      return {
        id,
        statusState: task.status.state,
        metadata: task.metadata,
        updatedAt:
          typeof task.metadata?.testUpdatedAt === "number"
            ? task.metadata.testUpdatedAt
            : task.updatedAt,
        createdAt:
          typeof task.metadata?.testCreatedAt === "number"
            ? task.metadata.testCreatedAt
            : task.createdAt,
      };
    },
    async touchQueuedA2ATaskDispatch() {
      return true;
    },
    async touchProcessingA2ATask(id: string) {
      const task = tasks[id];
      if (!task || task.status.state !== "processing") return false;
      task.updatedAt = Date.now();
      return true;
    },
    async resetStuckA2ATaskForRetry(id: string) {
      const task = tasks[id];
      if (!task || task.status.state !== "processing") return false;
      task.status = {
        state: "working",
        message: task.status.message,
        timestamp: new Date().toISOString(),
      };
      task.updatedAt = Date.now();
      return true;
    },
    async failStuckA2ATask(id: string, _cutoff: number, reason: string) {
      const task = tasks[id];
      if (!task || task.status.state !== "processing") return false;
      task.status = {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: reason }],
        },
        timestamp: new Date().toISOString(),
      };
      task.updatedAt = Date.now();
      return true;
    },
    async failStuckQueuedA2ATask(id: string, _cutoff: number, reason: string) {
      const task = tasks[id];
      if (!task || !["submitted", "working"].includes(task.status.state)) {
        return false;
      }
      task.status = {
        state: "failed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: reason }],
        },
        timestamp: new Date().toISOString(),
      };
      task.updatedAt = Date.now();
      return true;
    },
  };
});

// Mock the integrations/internal-token import so the a2a handler tests don't
// require A2A_SECRET to be set in the test environment for sign().
vi.mock("../integrations/internal-token.js", () => ({
  signInternalToken: () => "test-token",
  verifyInternalToken: () => true,
  extractBearerToken: (h?: string) => h?.replace(/^Bearer\s+/i, "") ?? null,
}));

vi.mock("../shared/agent-chat.js", () => ({
  agentChat: {
    call: vi.fn().mockResolvedValue({
      response: "Agent says hello",
      filesChanged: ["events.json"],
      warnings: [],
    }),
  },
}));

vi.mock("../org/context.js", () => ({
  getA2ASecretByDomain: getA2ASecretByDomainMock,
  resolveOrgByDomain: resolveOrgByDomainMock,
  resolveA2AOrganizationCredentialsByDomain:
    resolveA2AOrganizationCredentialsByDomainMock,
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

vi.mock("./client.js", () => ({
  callAction: callActionMock,
}));

vi.mock("../server/agent-discovery.js", () => ({
  findWorkspaceDispatchAgent: findWorkspaceDispatchAgentMock,
}));

vi.mock("../file-upload/registry.js", () => ({
  uploadFile: uploadFileMock,
}));

const evaluateServicePrincipalMock = vi.hoisted(() => vi.fn());
vi.mock("../org/service-principal-policy.js", async (importActual) => ({
  ...(await importActual<
    typeof import("../org/service-principal-policy.js")
  >()),
  evaluateServicePrincipal: evaluateServicePrincipalMock,
}));
const recordServicePrincipalDenialMock = vi.hoisted(() => vi.fn());
vi.mock("../org/service-principal-guard.js", async (importActual) => ({
  ...(await importActual<typeof import("../org/service-principal-guard.js")>()),
  recordServicePrincipalDenial: recordServicePrincipalDenialMock,
}));

function mockEvent(): any {
  return {
    _status: 200,
    _headers: {} as Record<string, string>,
    node: {
      res: {
        _writes: [] as string[],
        _ended: false,
        write(data: string) {
          this._writes.push(data);
        },
        end() {
          this._ended = true;
        },
      },
    },
  };
}

describe("handleJsonRpc", () => {
  beforeEach(() => {
    evaluateServicePrincipalMock.mockReset();
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    recordServicePrincipalDenialMock.mockReset();
    resolveOrgByDomainMock.mockReset();
    resolveA2AOrganizationCredentialsByDomainMock.mockReset();
    resolveOrgIdForEmailMock.mockReset();
    getA2ASecretByDomainMock.mockReset();
    callActionMock.mockReset();
    findWorkspaceDispatchAgentMock.mockReset();
    findWorkspaceDispatchAgentMock.mockReturnValue({
      id: "dispatch",
      name: "Dispatch",
      description: "Workspace control plane",
      url: "https://dispatch.agent-native.test",
      color: "#000000",
    });
    uploadFileMock.mockReset();
    claimTaskExecutionLeaseMock.mockClear();
    renewTaskExecutionLeaseMock.mockClear();
    releaseTurnExecutionLeaseMock.mockClear();
    uploadFileMock.mockResolvedValue({
      url: "https://storage.agent-native.test/artifacts/report.png",
      provider: "test-storage",
    });
    callActionMock.mockResolvedValue({
      action: "resolve-integration-source-context",
      status: "completed",
      output: JSON.stringify({
        platform: "slack",
        sourceUrl: "https://example-workspace.slack.com/archives/C123/p123456",
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    unregisterTrackingProvider("a2a-read-invoke-test");
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const customHandler: A2AConfig = {
    name: "Test Agent",
    description: "Test",
    skills: [{ id: "test", name: "Test", description: "Test skill" }],
    handler: async (message) => ({
      message: {
        role: "agent",
        parts: [{ type: "text", text: "custom response" }],
      },
    }),
  };

  it("carries the MCP user through durable local submission and processing", async () => {
    const { createMcpAgentTaskClient } = await import("./mcp-task-client.js");
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    const handler = vi.fn(async () => ({
      message: {
        role: "agent" as const,
        parts: [
          {
            type: "text" as const,
            text: `${getRequestUserEmail()}:${getRequestOrgId()}`,
          },
        ],
      },
    }));
    const config = { ...customHandler, handler };
    const event = mockEvent();
    event.context = { __a2aVerifiedEmail: "untrusted@example.test" };
    const client = createMcpAgentTaskClient(config, event);
    const task = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        client.send(
          { role: "user", parts: [{ type: "text", text: "read only" }] },
          {
            async: true,
            metadata: {
              userEmail: "forged@example.test",
              __a2a_processor: { verifiedEmail: "forged@example.test" },
            },
          },
        ),
    );
    await processA2ATaskFromQueue(task.id, config);
    const completed = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () => client.getTask(task.id),
    );
    expect(completed.status).toMatchObject({
      state: "completed",
      message: { parts: [{ type: "text", text: "alice@example.test:org-1" }] },
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(completed.metadata).not.toHaveProperty("__a2a_processor");
    expect(completed.metadata).not.toHaveProperty("userEmail");
    expect(event.context.__a2aVerifiedEmail).toBe("untrusted@example.test");
    for (const caller of [
      { userEmail: "bob@example.test", orgId: "org-1" },
      { userEmail: "alice@example.test", orgId: "org-2" },
      { userEmail: "alice@example.test", orgScope: "personal" as const },
      { orgId: "org-1" },
    ]) {
      await expect(
        runWithRequestContext(caller, () => client.getTask(task.id)),
      ).rejects.toThrow();
    }
    await expect(
      runWithRequestContext({ orgId: "org-1" }, () =>
        client.send(
          { role: "user", parts: [{ type: "text", text: "read only" }] },
          { metadata: { userEmail: "alice@example.test" } },
        ),
      ),
    ).rejects.toThrow("authenticated MCP user");
  });

  it("provides a cancellation signal to the fenced task handler", async () => {
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    let handlerSignal: AbortSignal | undefined;
    const config = {
      ...customHandler,
      handler: async (
        _message: Message,
        context: import("./types.js").A2AHandlerContext,
      ) => {
        handlerSignal = context.signal;
        return {
          message: {
            role: "agent" as const,
            parts: [{ type: "text" as const, text: "done" }],
          },
        };
      },
    };
    const submitted = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "do work" }],
          },
        },
      },
      mockEvent(),
      config,
    );

    await processA2ATaskFromQueue(submitted.result.id, config);

    expect(handlerSignal).toBeInstanceOf(AbortSignal);
    expect(handlerSignal?.aborted).toBe(false);
    expect(claimTaskExecutionLeaseMock).toHaveBeenCalledWith(
      `a2a-task:${submitted.result.id}`,
      submitted.result.id,
      expect.stringMatching(/^a2a:/),
    );
    expect(releaseTurnExecutionLeaseMock).toHaveBeenCalledOnce();
  });

  it("leaves an approval-waiting task unchanged when a duplicate cannot claim its lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    const store = await import("./task-store.js");
    const submitted = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "send this after approval" }],
          },
        },
      },
      mockEvent(),
      customHandler,
    );
    const approvalMessage: Message = {
      role: "agent",
      parts: [{ type: "text", text: "Approval required" }],
    };
    await store.updateTask(submitted.result.id, {
      state: "working",
      message: approvalMessage,
    });
    const before = await store.getTask(submitted.result.id);
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    const busyError = Object.assign(
      new Error("Another worker still owns this A2A task"),
      { code: "turn_execution_lease_busy" },
    );
    claimTaskExecutionLeaseMock.mockRejectedValueOnce(busyError);

    await expect(
      processA2ATaskFromQueue(submitted.result.id, customHandler),
    ).rejects.toBe(busyError);

    expect(await store.getTask(submitted.result.id)).toMatchObject({
      status: before?.status,
      updatedAt: before?.updatedAt,
    });
    expect(releaseTurnExecutionLeaseMock).not.toHaveBeenCalled();
  });

  it("stops a task handler when its heartbeat cannot confirm lease renewal", async () => {
    vi.useFakeTimers();
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    let handlerSignal: AbortSignal | undefined;
    let markHandlerStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      markHandlerStarted = resolve;
    });
    const config: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => {
        handlerSignal = context.signal;
        markHandlerStarted();
        await new Promise<void>((resolve) => {
          context.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return {
          message: {
            role: "agent",
            parts: [{ type: "text", text: "stopped" }],
          },
        };
      },
    };
    const submitted = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "do work" }],
          },
        },
      },
      mockEvent(),
      config,
    );
    const processing = processA2ATaskFromQueue(submitted.result.id, config);
    await handlerStarted;
    renewTaskExecutionLeaseMock.mockRejectedValueOnce(
      new Error("database unavailable during heartbeat"),
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await processing;

    expect(handlerSignal?.aborted).toBe(true);
    expect(handlerSignal?.reason).toMatchObject({
      code: "a2a_task_claim_lost",
    });
    expect(renewTaskExecutionLeaseMock).toHaveBeenCalledOnce();
  });

  it("rechecks suspended service principals before local agent task access", async () => {
    const { createMcpAgentTaskClient } = await import("./mcp-task-client.js");
    evaluateServicePrincipalMock.mockResolvedValueOnce({ status: "suspended" });
    const client = createMcpAgentTaskClient(customHandler, mockEvent());
    await expect(
      runWithRequestContext(
        { userEmail: "svc-qa@service.org-1", orgId: "org-1" },
        () => client.getTask("task-1"),
      ),
    ).rejects.toMatchObject({ errorCode: "service_principal_inactive" });
  });

  it("returns the durable handle when local dispatch exceeds the request budget", async () => {
    vi.useFakeTimers();
    const { createMcpAgentTaskClient } = await import("./mcp-task-client.js");
    const client = createMcpAgentTaskClient(customHandler, mockEvent());
    let finishDispatch!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDispatch = resolve;
        }),
    );
    const options = {
      async: true,
      deadlineMs: Date.now() + 100,
      idempotencyKey: "local-delayed-dispatch",
    };
    const message = {
      role: "user" as const,
      parts: [{ type: "text" as const, text: "read only" }],
    };
    const pending = runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () => client.send(message, options),
    );
    const settled = vi.fn();
    void pending.then(settled);
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).not.toHaveBeenCalled();
    finishDispatch(new Response("ok"));
    const task = await pending;
    const recovered = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () => client.getTask(task.id),
    );
    expect(recovered.id).toBe(task.id);
    const retry = await runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () => client.send(message, { ...options, deadlineMs: Date.now() + 100 }),
    );
    expect(retry.id).toBe(task.id);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects an expired local submission before creating or dispatching work", async () => {
    const { createMcpAgentTaskClient } = await import("./mcp-task-client.js");
    const client = createMcpAgentTaskClient(customHandler, mockEvent());
    await expect(
      runWithRequestContext(
        { userEmail: "alice@example.test", orgId: "org-1" },
        () =>
          client.send(
            { role: "user", parts: [{ type: "text", text: "read only" }] },
            { deadlineMs: Date.now() - 1 },
          ),
      ),
    ).rejects.toThrow("timeout");
    expect(fetch).not.toHaveBeenCalled();
    expect(evaluateServicePrincipalMock).not.toHaveBeenCalled();
  });

  it("bounds local status reads while admission is still pending", async () => {
    vi.useFakeTimers();
    const { createMcpAgentTaskClient } = await import("./mcp-task-client.js");
    evaluateServicePrincipalMock.mockImplementationOnce(
      () => new Promise(() => {}),
    );
    const client = createMcpAgentTaskClient(customHandler, mockEvent());
    const pending = runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () => client.getTask("task-1", { requestTimeoutMs: 100 }),
    );
    const assertion = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("times out local admission and prevents late admission from creating a task", async () => {
    vi.useFakeTimers();
    const { createMcpAgentTaskClient } = await import("./mcp-task-client.js");
    const taskStore = await import("./task-store.js");
    const persist = vi.spyOn(taskStore, "createOrReuseTask");
    let finishAdmission!: () => void;
    evaluateServicePrincipalMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishAdmission = () => resolve({ status: "not-service" });
        }),
    );
    const client = createMcpAgentTaskClient(customHandler, mockEvent());
    const pending = runWithRequestContext(
      { userEmail: "alice@example.test", orgId: "org-1" },
      () =>
        client.send(
          { role: "user", parts: [{ type: "text", text: "read only" }] },
          { deadlineMs: Date.now() + 100 },
        ),
    );
    const assertion = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    finishAdmission();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    persist.mockRestore();
  });

  it("rejects invalid JSON-RPC requests", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc({}, event, customHandler);
    expect(event._status).toBe(400);
    expect(result.error.code).toBe(-32600);
  });

  it("rejects unknown methods", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      { jsonrpc: "2.0", id: 1, method: "unknown/method" },
      event,
      customHandler,
    );
    expect(result.error.code).toBe(-32601);
    expect(result.error.message).toContain("unknown/method");
  });

  it("runs direct actions only with a verified user request context", async () => {
    const executeReadOnlyAction = vi.fn(async ({ action, input }) => ({
      status: "completed" as const,
      output: JSON.stringify({
        action,
        input,
        userEmail: getRequestUserEmail(),
        orgId: getRequestOrgId() ?? null,
        orgScope: getRequestContext()?.orgScope,
      }),
    }));
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aAudienceVerified: true,
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "actions/invoke",
        params: {
          action: "gong-calls",
          input: { company: "Acme" },
        },
      },
      event,
      { ...customHandler, executeReadOnlyAction },
    );

    expect(result.error).toBeUndefined();
    expect(result.id).toBe(12);
    expect(result.result).toEqual({
      action: "gong-calls",
      status: "completed",
      output: JSON.stringify({
        action: "gong-calls",
        input: { company: "Acme" },
        userEmail: "alice+qa@agent-native.example.com",
        orgId: null,
        orgScope: "personal",
      }),
    });
    expect(executeReadOnlyAction).toHaveBeenCalledOnce();
  });

  it("preserves org-member assurance for synchronous A2A calls", async () => {
    const delegatedContextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: getRequestContext()?.a2aIdentityAssurance ?? "none",
            },
          ],
        },
      }),
      executeReadOnlyAction: async () => ({
        status: "completed",
        output: getRequestContext()?.a2aIdentityAssurance ?? "none",
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "owner@builder.io",
      __a2aVerifiedOrgId: "org-builder",
      __a2aIdentityAssurance: "org-member",
      __a2aAudienceVerified: true,
    };

    const sent = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      event,
      delegatedContextConfig,
    );
    expect(sent.result.status.message.parts[0].text).toBe("org-member");

    const invoked = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "actions/invoke",
        params: { action: "read", input: {} },
      },
      event,
      delegatedContextConfig,
    );
    expect(invoked.result.output).toBe("org-member");
  });

  it("uses the verified stable org id for direct action access", async () => {
    const executeReadOnlyAction = vi.fn(async () => ({
      status: "completed" as const,
      output: JSON.stringify({
        userEmail: getRequestUserEmail(),
        orgId: getRequestOrgId(),
      }),
    }));
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aAudienceVerified: true,
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-acme",
    };

    resolveOrgIdForEmailMock.mockResolvedValue("org-reassigned");
    resolveOrgByDomainMock.mockResolvedValue({ orgId: "org-reassigned" });
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 17,
        method: "actions/invoke",
        params: { action: "read", input: {} },
      },
      event,
      { ...customHandler, executeReadOnlyAction },
    );

    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.result.output)).toEqual({
      userEmail: "alice@example.org",
      orgId: "org-acme",
    });
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("rejects direct action invocation with an unbound organization claim", async () => {
    const executeReadOnlyAction = vi.fn();
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aAudienceVerified: true,
      __a2aOrgDomain: "shared.test",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 18,
        method: "actions/invoke",
        params: { action: "read", input: {} },
      },
      event,
      { ...customHandler, executeReadOnlyAction },
    );

    expect(result.error).toMatchObject({ code: -32001 });
    expect(executeReadOnlyAction).not.toHaveBeenCalled();
  });

  it("tracks content-free direct read correlation with verified identity", async () => {
    const events: any[] = [];
    registerTrackingProvider({
      name: "a2a-read-invoke-test",
      track: (event) => events.push(event),
    });
    const executeReadOnlyAction = vi.fn(async () => ({
      status: "completed" as const,
      output: "sensitive-result-content",
    }));
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aAudienceVerified: true,
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 16,
        method: "actions/invoke",
        params: {
          action: "gong-calls",
          input: { secretArgument: "do-not-track" },
          metadata: {
            callerApp: "mail",
            callerThreadId: "thread-qa",
            parentRunId: "run-qa",
            parentTurnId: "turn-qa",
            invocationId: "invoke-qa",
          },
        },
      },
      event,
      {
        ...customHandler,
        appId: "analytics",
        executeReadOnlyAction,
      },
    );

    expect(executeReadOnlyAction).toHaveBeenCalledWith({
      action: "gong-calls",
      input: { secretArgument: "do-not-track" },
      invocationId: expect.any(String),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "$a2a_read_invoke",
      userId: "alice+qa@agent-native.example.com",
      properties: {
        action: "gong-calls",
        receiver_app: "analytics",
        caller_app: "mail",
        status: "completed",
        invocation_id: expect.any(String),
        caller_invocation_id: "invoke-qa",
        parent_run_id: "run-qa",
        parent_turn_id: "turn-qa",
        duration_ms: expect.any(Number),
      },
    });
    expect(events[0].properties).not.toHaveProperty("input");
    expect(events[0].properties).not.toHaveProperty("output");
    expect(JSON.stringify(events[0])).not.toContain("do-not-track");
    expect(JSON.stringify(events[0])).not.toContain("sensitive-result-content");
  });

  it("rejects direct action invocation without a verified identity", async () => {
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "actions/invoke",
        params: { action: "gong-calls", input: {} },
      },
      mockEvent(),
      {
        ...customHandler,
        executeReadOnlyAction: vi.fn(),
      },
    );

    expect(result.error).toMatchObject({
      code: -32001,
      message: expect.stringContaining("audience-bound user identity"),
    });
  });

  it("rejects direct action invocation from a legacy non-audience token", async () => {
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 14,
        method: "actions/invoke",
        params: { action: "gong-calls", input: {} },
      },
      event,
      { ...customHandler, executeReadOnlyAction: vi.fn() },
    );

    expect(result.error).toMatchObject({ code: -32001 });
  });

  it("caps direct action input before receiver execution", async () => {
    const executeReadOnlyAction = vi.fn();
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aAudienceVerified: true,
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 15,
        method: "actions/invoke",
        params: { action: "gong-calls", input: { value: "x".repeat(70_000) } },
      },
      event,
      { ...customHandler, executeReadOnlyAction },
    );

    expect(result.error).toMatchObject({ code: -32602 });
    expect(executeReadOnlyAction).not.toHaveBeenCalled();
  });

  it("handles message/send with custom handler", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      event,
      customHandler,
    );
    expect(result.error).toBeUndefined();
    expect(result.id).toBe(1);
    const task = result.result;
    expect(task.status.state).toBe("completed");
    expect(task.status.message.parts[0].text).toBe("custom response");
  });

  it("admits a chat-turn proof, hides it from the handler, and scopes the handler to the grant", async () => {
    const seen: Array<{ metadata: unknown; interactive: boolean }> = [];
    const config = {
      ...customHandler,
      handler: async (message: Message) => {
        seen.push({
          metadata: message.metadata,
          interactive: isProviderInteractiveScope(),
        });
        return {
          message: { role: "agent", parts: [{ type: "text", text: "ok" }] },
        } as never;
      },
    };
    const send = (claim?: unknown) => {
      const event = mockEvent();
      event.context = {
        __a2aVerifiedEmail: "alice@example.org",
        __a2aIdentityAssurance: "user",
      };
      return handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ type: "text", text: "hi" }],
              ...(claim
                ? { metadata: { __agentNativeMcpChatTurn: claim, keep: 1 } }
                : {}),
            },
          },
        },
        event,
        config,
      );
    };

    await send();
    expect(seen.at(-1)).toMatchObject({ interactive: false });
    expect(chatTurn.admit).toHaveBeenLastCalledWith(
      undefined,
      expect.anything(),
    );

    chatTurn.read.mockResolvedValueOnce({
      status: "admitted",
      grant: {
        owner: "alice@example.org",
        appId: "test-app",
        runId: "t",
        turnId: "t",
        expiresAt: Date.now() + 60_000,
      },
    });
    await send({ v: "claim" });
    expect(chatTurn.admit).toHaveBeenLastCalledWith(
      { v: "claim" },
      expect.objectContaining({
        owner: "alice@example.org",
        assurance: "user",
      }),
    );
    expect(seen.at(-1)).toEqual({ metadata: { keep: 1 }, interactive: true });
  });

  it("fails the task instead of running it when a chat-turn proof is refused", async () => {
    const handler = vi.fn(customHandler.handler!);
    const config = { ...customHandler, handler };
    const send = () => {
      const event = mockEvent();
      event.context = {
        __a2aVerifiedEmail: "alice@example.org",
        __a2aIdentityAssurance: "user",
      };
      return handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 8,
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ type: "text", text: "hi" }],
              metadata: { __agentNativeMcpChatTurn: { v: "claim" } },
            },
          },
        },
        event,
        config,
      );
    };

    chatTurn.admit.mockResolvedValueOnce({
      status: "refused",
      reason: "replay",
    });
    const replayed = await send();
    expect(replayed.error?.message).toContain("replay");

    chatTurn.read.mockResolvedValueOnce({
      status: "refused",
      reason: "durable-invalid-or-expired",
    });
    const unreadable = await send();
    expect(unreadable.error?.message).toContain("durable-invalid-or-expired");
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs an ordinary verified task when the chat-turn lookup is unavailable", async () => {
    const handler = vi.fn(customHandler.handler!);
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aIdentityAssurance: "user",
    };
    chatTurn.read.mockResolvedValueOnce({
      status: "refused",
      reason: "storage-or-signing-unavailable",
    });
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "message/send",
        params: {
          message: { role: "user", parts: [{ type: "text", text: "hi" }] },
        },
      },
      event,
      { ...customHandler, handler },
    );
    expect(result.error).toBeUndefined();
    expect(handler).toHaveBeenCalled();
  });

  it("fails a task that presented a proof when the chat-turn lookup is unavailable", async () => {
    const handler = vi.fn(customHandler.handler!);
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aIdentityAssurance: "user",
    };
    chatTurn.read.mockResolvedValueOnce({
      status: "refused",
      reason: "storage-or-signing-unavailable",
    });
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
            metadata: { __agentNativeMcpChatTurn: { v: "claim" } },
          },
        },
      },
      event,
      { ...customHandler, handler },
    );
    expect(result.error?.message).toContain("storage-or-signing-unavailable");
    expect(handler).not.toHaveBeenCalled();
  });

  it("reuses an authenticated owner's task for duplicate message/send keys", async () => {
    const handler = vi.fn(customHandler.handler!);
    const config = { ...customHandler, handler };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aAudienceVerified: true,
      __a2aOrgDomain: "acme.test",
      __a2aVerifiedOrgId: "org-acme",
    };
    const request = {
      jsonrpc: "2.0",
      id: 21,
      method: "message/send",
      params: {
        async: true,
        idempotencyKey: "v1:stable-message",
        message: {
          role: "user",
          parts: [{ type: "text", text: "do this once" }],
        },
      },
    };

    const first = await handleJsonRpc(request, event, config);
    const duplicate = await handleJsonRpc(request, event, config);

    expect(duplicate.result.id).toBe(first.result.id);
    expect(duplicate.result.status.state).toBe("working");
    expect(duplicate.result.ownerEmail).toBeUndefined();
    expect(duplicate.result.ownerScope).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("reuses an organization principal's task without a user email", async () => {
    const handler = vi.fn(customHandler.handler!);
    const config = { ...customHandler, handler };
    const event = mockEvent();
    event.context = {
      __a2aIdentityAssurance: "organization",
      __a2aVerifiedOrgId: "org-acme",
    };
    const request = {
      jsonrpc: "2.0",
      id: 25,
      method: "message/send",
      params: {
        async: true,
        idempotencyKey: "v1:org-stable-message",
        message: {
          role: "user",
          parts: [{ type: "text", text: "do this once for the organization" }],
        },
      },
    };

    const first = await handleJsonRpc(request, event, config);
    const duplicate = await handleJsonRpc(request, event, config);

    expect(duplicate.result.id).toBe(first.result.id);
    expect(duplicate.result.status.state).toBe("working");
    expect(duplicate.result.ownerEmail).toBeUndefined();
    expect(duplicate.result.ownerScope).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns a person's unfinished personal task when its retry lands in their sole workspace", async () => {
    const caller = (context: Record<string, unknown>) => {
      const event = mockEvent();
      event.context = {
        __a2aVerifiedEmail: "alice@example.org",
        __a2aAudienceVerified: true,
        ...context,
      };
      return event;
    };
    const request = (id: number, idempotencyKey: string) => ({
      jsonrpc: "2.0",
      id,
      method: "message/send",
      params: {
        async: true,
        idempotencyKey,
        message: {
          role: "user",
          parts: [{ type: "text", text: "make one deck" }],
        },
      },
    });
    const soleWorkspace = {
      __a2aVerifiedOrgId: "org-slides",
      __a2aOrgFromSoleMembership: true,
    };

    const personal = await handleJsonRpc(
      request(26, "v1:across-the-switch"),
      caller({}),
      customHandler,
    );
    const retried = await handleJsonRpc(
      request(27, "v1:across-the-switch"),
      caller(soleWorkspace),
      customHandler,
    );
    const claimed = await handleJsonRpc(
      request(28, "v1:across-the-switch"),
      caller({ __a2aVerifiedOrgId: "org-slides" }),
      customHandler,
    );
    expect(retried.result.id).toBe(personal.result.id);
    expect(claimed.result.id).not.toBe(personal.result.id);

    const failed = await handleJsonRpc(
      request(29, "v1:failed-before-the-switch"),
      caller({}),
      customHandler,
    );
    const { updateTask } = await import("./task-store.js");
    await updateTask(failed.result.id, { state: "failed" });
    const afterFailure = await handleJsonRpc(
      request(30, "v1:failed-before-the-switch"),
      caller(soleWorkspace),
      customHandler,
    );
    expect(afterFailure.result.id).not.toBe(failed.result.id);
  });

  it("does not reuse an unfinished synchronous submission", async () => {
    const handler = vi.fn(customHandler.handler!);
    const config = { ...customHandler, handler };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aAudienceVerified: true,
      __a2aOrgDomain: "acme.test",
      __a2aVerifiedOrgId: "org-acme",
    };
    const request = {
      jsonrpc: "2.0",
      id: 24,
      method: "message/send",
      params: {
        idempotencyKey: "v1:sync-key",
        message: {
          role: "user",
          parts: [{ type: "text", text: "run synchronously" }],
        },
      },
    };

    const first = await handleJsonRpc(request, event, config);
    const second = await handleJsonRpc(request, event, config);

    expect(second.result.id).not.toBe(first.result.id);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("fails a queued task whose service principal was suspended after submission", async () => {
    const handler = vi.fn(customHandler.handler!);
    const config = { ...customHandler, handler };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "svc-ci@service.org-acme",
      __a2aAudienceVerified: true,
      __a2aVerifiedOrgId: "org-acme",
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 28,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "run later" }],
          },
        },
      },
      event,
      config,
    );
    const taskId = created.result.id;
    evaluateServicePrincipalMock.mockResolvedValue({
      status: "suspended",
      policy: { lifecycle: "suspended" },
    });

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(taskId, config);

    const failed = await handleJsonRpc(
      { jsonrpc: "2.0", id: 29, method: "tasks/get", params: { id: taskId } },
      event,
      config,
    );
    expect(failed.result.status.state).toBe("failed");
    expect(failed.result.status.message.parts[0].text).toContain(
      "suspended or retired",
    );
    expect(handler).not.toHaveBeenCalled();
    expect(recordServicePrincipalDenialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "a2a:process-task",
        caller: "a2a",
        orgId: "org-acme",
        error: expect.objectContaining({ statusCode: 403 }),
      }),
    );
  });

  it("does not audit a queued denial under the service email's unverified org", async () => {
    const config = { ...customHandler, handler: vi.fn(customHandler.handler!) };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "svc-ci@service.org-acme",
      __a2aAudienceVerified: true,
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 33,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "run with no verified org" }],
          },
        },
      },
      event,
      config,
    );
    evaluateServicePrincipalMock.mockResolvedValue({ status: "org-mismatch" });

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(created.result.id, config);

    expect(recordServicePrincipalDenialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "svc-ci@service.org-acme",
        orgId: undefined,
        actionName: "a2a:process-task",
      }),
    );
  });

  it("requeues a task when service-principal policy is temporarily unavailable", async () => {
    const handler = vi.fn(customHandler.handler!);
    const config = { ...customHandler, handler };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "svc-ci@service.org-acme",
      __a2aAudienceVerified: true,
      __a2aVerifiedOrgId: "org-acme",
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 30,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "run after policy recovers" }],
          },
        },
      },
      event,
      config,
    );
    const taskId = created.result.id;
    evaluateServicePrincipalMock.mockResolvedValue({ status: "unavailable" });

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await expect(processA2ATaskFromQueue(taskId, config)).rejects.toMatchObject(
      { statusCode: 503 },
    );
    const requeued = await handleJsonRpc(
      { jsonrpc: "2.0", id: 31, method: "tasks/get", params: { id: taskId } },
      event,
      config,
    );
    expect(requeued.result.status.state).toBe("working");
    expect(recordServicePrincipalDenialMock).not.toHaveBeenCalled();

    evaluateServicePrincipalMock.mockResolvedValue({
      status: "active",
      policy: { lifecycle: "active", allowedActions: null },
    });
    await processA2ATaskFromQueue(taskId, config);

    const completed = await handleJsonRpc(
      { jsonrpc: "2.0", id: 32, method: "tasks/get", params: { id: taskId } },
      event,
      config,
    );
    expect(completed.result.status.state).toBe("completed");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("persists a structured error code on a failed async task message", async () => {
    const config: A2AConfig = {
      ...customHandler,
      handler: async () => {
        throw Object.assign(new Error("The provider connection is missing."), {
          agentNativeErrorCode: "missing_credentials",
        });
      },
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 26,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "read the provider data" }],
          },
        },
      },
      mockEvent(),
      config,
    );
    const taskId = created.result.id;

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(taskId, config);

    const failed = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 27,
        method: "tasks/get",
        params: { id: taskId },
      },
      mockEvent(),
      config,
    );

    expect(failed.result.status).toMatchObject({
      state: "failed",
      message: {
        parts: [
          {
            type: "text",
            text: "The provider connection is missing.",
          },
        ],
        metadata: { agentNativeErrorCode: "missing_credentials" },
      },
    });
  });

  it("answers a synchronous send with the canceled task when the cancel lands first", async () => {
    const ownerEvent = mockEvent();
    ownerEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-acme",
    };
    let markHandlerStarted!: (taskId: string) => void;
    const handlerStarted = new Promise<string>((resolve) => {
      markHandlerStarted = resolve;
    });
    let finishHandler!: () => void;
    const handlerFinished = new Promise<void>((resolve) => {
      finishHandler = resolve;
    });
    const slowConfig: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => {
        markHandlerStarted(context.taskId);
        await handlerFinished;
        return {
          message: {
            role: "agent",
            parts: [{ type: "text", text: "late result" }],
          },
        };
      },
    };

    const send = handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 80,
        method: "message/send",
        params: {
          message: { role: "user", parts: [{ type: "text", text: "slow" }] },
        },
      },
      ownerEvent,
      slowConfig,
    );
    const taskId = await handlerStarted;

    const canceled = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 81,
        method: "tasks/cancel",
        params: { id: taskId },
      },
      ownerEvent,
      slowConfig,
    );
    expect(canceled.result.status.state).toBe("canceled");

    finishHandler();
    const sent = await send;
    expect(sent.error).toBeUndefined();
    expect(sent.result).toMatchObject({
      id: taskId,
      status: { state: "canceled" },
    });

    const read = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 82,
        method: "tasks/get",
        params: { id: taskId },
      },
      ownerEvent,
      slowConfig,
    );
    expect(read.result.status.state).toBe("canceled");
  });

  it("maps tasks/cancel on a final task to -32002 and leaves it completed", async () => {
    const ownerEvent = mockEvent();
    ownerEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-acme",
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 70,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "finish first" }],
          },
        },
      },
      ownerEvent,
      customHandler,
    );
    expect(created.result.status.state).toBe("completed");

    const canceled = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 71,
        method: "tasks/cancel",
        params: { id: created.result.id },
      },
      ownerEvent,
      customHandler,
    );
    expect({
      trace: renderMachineTrace(a2aTaskMachine, ["cancel"], "completed"),
      errorCode: canceled.error?.code,
    }).toMatchInlineSnapshot(`
      {
        "errorCode": -32002,
        "trace": "cancel -> completed (rejected) [guard: 'submitted', 'working', 'processing', 'input-required']",
      }
    `);
    expect(canceled.error).toMatchObject({
      code: -32002,
      message: 'Task cannot be canceled from state "completed"',
    });

    const missing = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 73,
        method: "tasks/cancel",
        params: { id: "no-such-task" },
      },
      ownerEvent,
      customHandler,
    );
    expect(missing.error).toMatchObject({
      code: -32001,
      message: "Task not found",
    });

    const read = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 72,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      ownerEvent,
      customHandler,
    );
    expect(read.result.status.state).toBe("completed");
  });

  it("does not expose a task to the same user in another org scope", async () => {
    const ownerEvent = mockEvent();
    ownerEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-acme",
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 25,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "scoped work" }],
          },
        },
      },
      ownerEvent,
      customHandler,
    );
    const otherOrgEvent = mockEvent();
    otherOrgEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-other",
    };

    const denied = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 26,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      otherOrgEvent,
      customHandler,
    );

    expect(denied.error).toMatchObject({
      code: -32001,
      message: "Task not found",
    });

    const canceled = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 27,
        method: "tasks/cancel",
        params: { id: created.result.id },
      },
      otherOrgEvent,
      customHandler,
    );
    expect(canceled.error).toMatchObject({ code: -32001 });

    const ownerRead = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 28,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      ownerEvent,
      customHandler,
    );
    expect(ownerRead.result.status.state).toBe("completed");
  });

  it("does not use a legacy domain scope after a domain is reassigned", async () => {
    const ownerEvent = mockEvent();
    ownerEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-acme",
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 29,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "legacy scoped task" }],
          },
        },
      },
      ownerEvent,
      customHandler,
    );
    const { setTaskOwnerScope } = (await import("./task-store.js")) as any;
    await setTaskOwnerScope(created.result.id, "shared.test");

    const reassignedOrgEvent = mockEvent();
    reassignedOrgEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-other",
    };
    const get = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 30,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      reassignedOrgEvent,
      customHandler,
    );
    const cancel = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 31,
        method: "tasks/cancel",
        params: { id: created.result.id },
      },
      reassignedOrgEvent,
      customHandler,
    );

    expect(get.error).toMatchObject({
      code: -32001,
      message: "Task not found",
    });
    expect(cancel.error).toMatchObject({ code: -32001 });
  });

  it("denies org-only callers access to legacy unscoped tasks", async () => {
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 32,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "legacy unscoped task" }],
          },
        },
      },
      mockEvent(),
      customHandler,
    );
    const orgOnlyCaller = mockEvent();
    orgOnlyCaller.context = {
      __a2aIdentityAssurance: "organization",
      __a2aVerifiedOrgId: "org-acme",
    };

    const get = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 33,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      orgOnlyCaller,
      customHandler,
    );
    const cancel = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 34,
        method: "tasks/cancel",
        params: { id: created.result.id },
      },
      orgOnlyCaller,
      customHandler,
    );

    expect(get.error).toMatchObject({
      code: -32001,
      message: "Task not found",
    });
    expect(cancel.error).toMatchObject({ code: -32001 });
  });

  it.each([null, ""])(
    "denies access to owner-backed legacy tasks without a stored scope (%s)",
    async (legacyScope) => {
      const ownerEvent = mockEvent();
      ownerEvent.context = {
        __a2aVerifiedEmail: "alice@example.org",
        __a2aOrgDomain: "shared.test",
        __a2aVerifiedOrgId: "org-acme",
      };
      const created = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 32,
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ type: "text", text: "legacy unscoped task" }],
            },
          },
        },
        ownerEvent,
        customHandler,
      );
      const { getTask, setTaskOwnerScope } =
        (await import("./task-store.js")) as any;
      await setTaskOwnerScope(created.result.id, legacyScope);

      const otherOrg = mockEvent();
      otherOrg.context = {
        __a2aVerifiedEmail: "alice@example.org",
        __a2aOrgDomain: "other.test",
        __a2aVerifiedOrgId: "org-other",
      };
      const get = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 33,
          method: "tasks/get",
          params: { id: created.result.id },
        },
        otherOrg,
        customHandler,
      );
      const cancel = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 34,
          method: "tasks/cancel",
          params: { id: created.result.id },
        },
        otherOrg,
        customHandler,
      );

      expect(get.error).toMatchObject({ code: -32001 });
      expect(cancel.error).toMatchObject({ code: -32001 });
      const ownerRead = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 35,
          method: "tasks/get",
          params: { id: created.result.id },
        },
        ownerEvent,
        customHandler,
      );
      expect(ownerRead.error).toMatchObject({ code: -32001 });
      const personalCaller = mockEvent();
      personalCaller.context = {
        __a2aVerifiedEmail: "alice@example.org",
      };
      const personalRead = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 36,
          method: "tasks/get",
          params: { id: created.result.id },
        },
        personalCaller,
        customHandler,
      );
      expect(personalRead.error).toMatchObject({ code: -32001 });
      expect(await getTask(created.result.id)).toMatchObject({
        status: { state: "completed" },
      });
    },
  );

  it("scopes new personal tasks to personal callers", async () => {
    const personalEvent = mockEvent();
    personalEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
    };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 36,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "legacy personal task" }],
          },
        },
      },
      personalEvent,
      customHandler,
    );
    const { getTaskOwnership } = (await import("./task-store.js")) as any;
    await expect(getTaskOwnership(created.result.id)).resolves.toEqual({
      ownerEmail: "alice@example.org",
      ownerScope: "__personal__",
    });

    const organizationCaller = mockEvent();
    organizationCaller.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "acme.test",
      __a2aVerifiedOrgId: "org-acme",
    };
    const denied = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 37,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      organizationCaller,
      customHandler,
    );
    expect(denied.error).toMatchObject({ code: -32001 });

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 38,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      personalEvent,
      customHandler,
    );

    expect(result.error).toBeUndefined();
    expect(result.result.status.state).toBe("completed");
  });

  it("keeps a person's personal tasks reachable once their claimless calls run in their sole workspace", async () => {
    const personalCaller = mockEvent();
    personalCaller.context = { __a2aVerifiedEmail: "alice@example.org" };
    const soleWorkspaceCaller = mockEvent();
    soleWorkspaceCaller.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aVerifiedOrgId: "org-slides",
      __a2aOrgFromSoleMembership: true,
    };
    const claimedWorkspaceCaller = mockEvent();
    claimedWorkspaceCaller.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aVerifiedOrgId: "org-slides",
    };
    const send = (event: ReturnType<typeof mockEvent>, id: number) =>
      handleJsonRpc(
        {
          jsonrpc: "2.0",
          id,
          method: "message/send",
          params: {
            message: {
              role: "user",
              parts: [{ type: "text", text: "make a deck" }],
            },
          },
        },
        event,
        customHandler,
      );
    const get = (
      event: ReturnType<typeof mockEvent>,
      id: number,
      taskId: string,
    ) =>
      handleJsonRpc(
        { jsonrpc: "2.0", id, method: "tasks/get", params: { id: taskId } },
        event,
        customHandler,
      );

    const personalTask = await send(personalCaller, 61);
    const workspaceTask = await send(soleWorkspaceCaller, 62);
    const { getTaskOwnership } = await import("./task-store.js");
    await expect(getTaskOwnership(workspaceTask.result.id)).resolves.toEqual({
      ownerEmail: "alice@example.org",
      ownerScope: "__a2a_org_id__:org-slides",
    });

    expect(
      (await get(soleWorkspaceCaller, 63, personalTask.result.id)).result.status
        .state,
    ).toBe("completed");
    expect(
      (await get(claimedWorkspaceCaller, 64, personalTask.result.id)).error,
    ).toMatchObject({ code: -32001, message: "Task not found" });
    expect(
      (await get(personalCaller, 65, workspaceTask.result.id)).error,
    ).toMatchObject({ code: -32001, message: "Task not found" });
    expect(
      (await get(soleWorkspaceCaller, 66, workspaceTask.result.id)).result
        .status.state,
    ).toBe("completed");

    const canceled = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 67,
        method: "tasks/cancel",
        params: { id: personalTask.result.id },
      },
      soleWorkspaceCaller,
      customHandler,
    );
    expect(canceled.error?.message).not.toBe("Task not found");
  });

  it("rejects a scoped submission without a verified stable org id", async () => {
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 34,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "do not use a mutable domain" }],
          },
        },
      },
      event,
      customHandler,
    );

    expect(result.error).toMatchObject({ code: -32001 });
  });

  it("rejects a streamed task without a verified stable org id", async () => {
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 35,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "do not use a mutable domain" }],
          },
        },
      },
      event,
      { ...customHandler, streaming: true },
    );

    const events = event.node.res._writes.map((chunk: string) =>
      JSON.parse(chunk.replace(/^data: /, "").trim()),
    );
    expect(events).toHaveLength(1);
    expect(events[0].error).toMatchObject({ code: -32001 });
    expect(events[0].result).toBeUndefined();
  });

  it("never hands a streamed task a chat-turn proof", async () => {
    const seen: unknown[] = [];
    const event = mockEvent();
    event.context = { __a2aVerifiedEmail: "alice@example.org" };
    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 36,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
            metadata: { __agentNativeMcpChatTurn: { v: "claim" }, keep: 1 },
          },
        },
      },
      event,
      {
        ...customHandler,
        streaming: true,
        handler: async (message: Message) => {
          seen.push(message.metadata);
          return {
            message: { role: "agent", parts: [{ type: "text", text: "ok" }] },
          } as never;
        },
      },
    );
    expect(seen).toEqual([{ keep: 1 }]);
  });

  it("preserves current submission behavior without an authenticated owner", async () => {
    const handler = vi.fn(customHandler.handler!);
    const config = { ...customHandler, handler };
    const request = {
      jsonrpc: "2.0",
      id: 22,
      method: "message/send",
      params: {
        idempotencyKey: "v1:ignored-without-owner",
        message: {
          role: "user",
          parts: [{ type: "text", text: "run normally" }],
        },
      },
    };

    const first = await handleJsonRpc(request, mockEvent(), config);
    const second = await handleJsonRpc(request, mockEvent(), config);

    expect(second.result.id).not.toBe(first.result.id);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("fails safely on an oversized authenticated idempotency key", async () => {
    const handler = vi.fn(customHandler.handler!);
    const event = mockEvent();
    event.context = { __a2aVerifiedEmail: "alice@example.org" };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 23,
        method: "message/send",
        params: {
          idempotencyKey: "x".repeat(129),
          message: {
            role: "user",
            parts: [{ type: "text", text: "do not enqueue" }],
          },
        },
      },
      event,
      { ...customHandler, handler },
    );

    expect(result.error).toMatchObject({ code: -32602 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("preserves an approval pause as input-required", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "send it" }],
          },
        },
      },
      event,
      {
        ...customHandler,
        handler: async function* () {
          yield {
            role: "agent",
            metadata: { agentNativeTaskState: "input-required" },
            parts: [{ type: "text", text: "Approval required" }],
          };
        },
      },
    );

    expect(result.result).toMatchObject({
      status: {
        state: "input-required",
        message: { parts: [{ type: "text", text: "Approval required" }] },
      },
    });
  });

  it("uses the receiving request origin instead of metadata for sync calls", async () => {
    const event = mockEvent();
    event.req = {
      headers: new Headers({
        host: "target.example.test",
        "x-forwarded-proto": "https",
      }),
    };
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: getRequestContext()?.requestOrigin ?? "none",
            },
          ],
        },
      }),
    };

    for (const requestOrigin of [
      "https://attacker.example.test",
      "http://localhost:3000",
      "http://169.254.169.254",
      "file:///tmp/receiver",
    ]) {
      const result = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "message/send",
          params: {
            metadata: { requestOrigin },
            message: {
              role: "user",
              parts: [{ type: "text", text: "hi" }],
            },
          },
        },
        event,
        contextConfig,
      );

      expect(result.result.status.message.parts[0].text).toBe(
        "https://target.example.test",
      );
    }
  });

  it("accepts a configured public origin distinct from the A2A transport", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("BETTER_AUTH_URL", "https://a2a.example.test");
    const event = mockEvent();
    event.req = {
      headers: new Headers({
        host: "a2a.example.test",
        "x-forwarded-proto": "https",
      }),
    };
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: getRequestContext()?.requestOrigin ?? "none",
            },
          ],
        },
      }),
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: { requestOrigin: "https://app.example.test" },
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      contextConfig,
    );

    expect(result.result.status.message.parts[0].text).toBe(
      "https://app.example.test",
    );
  });

  it("passes the H3 event through sync message/send handler context", async () => {
    const event = mockEvent();
    const eventAwareConfig: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: context.event === event ? "event-present" : "event-missing",
            },
          ],
        },
      }),
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      event,
      eventAwareConfig,
    );

    expect(result.error).toBeUndefined();
    expect(result.result.status.message.parts[0].text).toBe("event-present");
  });

  it("handles message/send with invalid message", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: {} },
      },
      event,
      customHandler,
    );
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe(-32602);
  });

  it("rejects inline file bytes before creating or running an A2A task", async () => {
    const handler = vi.fn(customHandler.handler!);
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [
              {
                type: "file",
                file: {
                  name: "reference.png",
                  mimeType: "image/png",
                  bytes: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                },
              },
            ],
          },
        },
      },
      mockEvent(),
      { ...customHandler, handler },
    );

    expect(result.error).toMatchObject({ code: -32602 });
    expect(result.error.message).toContain("send its URI instead");
    expect(handler).not.toHaveBeenCalled();
  });

  it("handles handler errors gracefully", async () => {
    const failConfig: A2AConfig = {
      ...customHandler,
      handler: async () => {
        throw new Error("handler exploded");
      },
    };
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      failConfig,
    );
    expect(result.error.code).toBe(-32000);
    expect(result.error.message).toBe("handler exploded");
  });

  it("rejects streaming when not enabled", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      { ...customHandler, streaming: false },
    );
    expect(result.error.code).toBe(-32601);
  });

  it("passes the H3 event through streaming handler context", async () => {
    const event = mockEvent();
    const eventAwareConfig: A2AConfig = {
      ...customHandler,
      streaming: true,
      handler: async function* (_message, context) {
        yield {
          role: "agent",
          parts: [
            {
              type: "text",
              text: context.event === event ? "event-present" : "event-missing",
            },
          ],
        };
      },
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      event,
      eventAwareConfig,
    );

    const chunks = event.node.res._writes.join("");
    expect(chunks).toContain("event-present");
    expect(chunks).not.toContain("event-missing");
  });

  it("preserves org-member assurance through streaming A2A calls", async () => {
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "owner@builder.io",
      __a2aVerifiedOrgId: "org-builder",
      __a2aIdentityAssurance: "org-member",
    };
    const delegatedContextConfig: A2AConfig = {
      ...customHandler,
      streaming: true,
      handler: async function* () {
        yield {
          role: "agent",
          parts: [
            {
              type: "text",
              text: getRequestContext()?.a2aIdentityAssurance ?? "none",
            },
          ],
        };
      },
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      event,
      delegatedContextConfig,
    );

    expect(event.node.res._writes.join("")).toContain("org-member");
    expect(event.node.res._writes.join("")).not.toContain("none");
  });

  it("scopes streamed tasks to the caller's verified organization", async () => {
    const ownerEvent = mockEvent();
    ownerEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "acme.test",
      __a2aVerifiedOrgId: "org-acme",
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      ownerEvent,
      { ...customHandler, streaming: true },
    );

    const streamEvents = ownerEvent.node.res._writes.map((chunk: string) =>
      JSON.parse(chunk.replace(/^data: /, "").trim()),
    );
    const taskId = streamEvents.find((entry: any) => entry.result?.id)?.result
      .id;
    expect(taskId).toBeTruthy();

    const otherOrgEvent = mockEvent();
    otherOrgEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "other.test",
      __a2aVerifiedOrgId: "org-other",
    };
    const denied = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      otherOrgEvent,
      customHandler,
    );

    expect(denied.error).toMatchObject({
      code: -32001,
      message: "Task not found",
    });
  });

  it("binds task ownership to the verified organization id after domain reassignment", async () => {
    const ownerEvent = mockEvent();
    ownerEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-acme",
    };

    const stream = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      ownerEvent,
      { ...customHandler, streaming: true },
    );
    const streamEvents = ownerEvent.node.res._writes.map((chunk: string) =>
      JSON.parse(chunk.replace(/^data: /, "").trim()),
    );
    const taskId = streamEvents.find((entry: any) => entry.result?.id)?.result
      .id;
    expect(taskId).toBeTruthy();

    const reassignedDomainEvent = mockEvent();
    reassignedDomainEvent.context = {
      __a2aVerifiedEmail: "alice@example.org",
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-evil",
    };
    const denied = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      reassignedDomainEvent,
      customHandler,
    );

    expect(denied.error).toMatchObject({
      code: -32001,
      message: "Task not found",
    });
  });

  it("handles tasks/get for unknown task", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: { id: "nonexistent" },
      },
      event,
      customHandler,
    );
    expect(result.error.code).toBe(-32001);
  });

  it("handles tasks/get without id", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: {},
      },
      event,
      customHandler,
    );
    expect(result.error.code).toBe(-32602);
  });

  it("handles tasks/cancel without id", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/cancel",
        params: {},
      },
      event,
      customHandler,
    );
    expect(result.error.code).toBe(-32602);
  });

  it("async message/send returns immediately and processor runs in fresh execution", async () => {
    let release: (v: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const slowConfig: A2AConfig = {
      ...customHandler,
      handler: async () => {
        await gate;
        return {
          message: {
            role: "agent",
            parts: [{ type: "text", text: "done eventually" }],
          },
        };
      },
    };

    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        },
      },
      event,
      slowConfig,
    );

    expect(result.error).toBeUndefined();
    expect(result.result.status.state).toBe("working");
    const taskId = result.result.id;

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    const processorPromise = processA2ATaskFromQueue(taskId, slowConfig);

    release(undefined);
    await processorPromise;
    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      mockEvent(),
      slowConfig,
    );
    expect(followup.error).toBeUndefined();
    expect(followup.result.status.state).toBe("completed");
    expect(followup.result.status.message.parts[0].text).toBe(
      "done eventually",
    );
  });

  it("stores writeArtifact file content in durable storage and persists only its URI", async () => {
    const content = "small image fixture bytes";
    const config: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => {
        expect(context.writeArtifact("report.png", content, "image/png")).toBe(
          "report.png",
        );
        return {
          message: {
            role: "agent",
            parts: [{ type: "text", text: "Created report.png" }],
          },
        };
      },
    };
    const event = mockEvent();
    event.context = { __a2aVerifiedEmail: "alice@example.test" };
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: { role: "user", parts: [{ type: "text", text: "create" }] },
        },
      },
      event,
      config,
    );
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(created.result.id, config);
    const readback = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      event,
      config,
    );

    expect(uploadFileMock).toHaveBeenCalledWith({
      data: Buffer.from(content, "utf8"),
      filename: "report.png",
      mimeType: "image/png",
      ownerEmail: "alice@example.test",
    });
    expect(readback.result.status.state).toBe("completed");
    expect(readback.result.artifacts).toEqual([
      {
        name: "report.png",
        parts: [
          {
            type: "file",
            file: {
              name: "report.png",
              mimeType: "image/png",
              uri: "https://storage.agent-native.test/artifacts/report.png",
            },
          },
        ],
      },
    ]);
    expect(JSON.stringify(readback.result)).not.toContain(
      "small image fixture bytes",
    );
    expect(JSON.stringify(readback.result)).not.toContain("base64");
  });

  it("settles the task with a typed failure when artifact storage is unavailable", async () => {
    uploadFileMock.mockResolvedValue(null);
    const config: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => {
        context.writeArtifact(
          "report.png",
          "small image fixture bytes",
          "image/png",
        );
        return {
          message: {
            role: "agent",
            parts: [{ type: "text", text: "Created report.png" }],
          },
        };
      },
    };
    const event = mockEvent();
    const created = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: { role: "user", parts: [{ type: "text", text: "create" }] },
        },
      },
      event,
      config,
    );
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(created.result.id, config);
    const readback = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: created.result.id },
      },
      event,
      config,
    );

    expect(readback.result.status.state).toBe("failed");
    expect(readback.result.status.message.metadata.agentNativeErrorCode).toBe(
      "A2A_ARTIFACT_STORAGE_UNAVAILABLE",
    );
    expect(readback.result.artifacts).toEqual([]);
  });

  it("fails stale processing async tasks instead of rerunning side effects from tasks/get", async () => {
    let started: (value: unknown) => void = () => {};
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    const handler = vi.fn(async () => {
      started(undefined);
      return new Promise<never>(() => {});
    });
    const sideEffectConfig: A2AConfig = {
      ...customHandler,
      handler,
    };
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            testUpdatedAt: Date.now() - 5 * 60 * 1000 - 1,
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "create something" }],
          },
        },
      },
      event,
      sideEffectConfig,
    );
    expect(result.error).toBeUndefined();
    const taskId = result.result.id;

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    void processA2ATaskFromQueue(taskId, sideEffectConfig);
    await startedPromise;

    const status = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      event,
      sideEffectConfig,
    );

    expect(status.error).toBeUndefined();
    expect(status.result.status.state).toBe("failed");
    expect(status.result.status.message.parts[0].text).toContain(
      "async A2A processor timed out",
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fails a queued async task that never leaves submitted/working past the lifetime cap", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            testCreatedAt: Date.now() - 3 * 60 * 1000 - 1,
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        },
      },
      event,
      customHandler,
    );
    expect(result.error).toBeUndefined();
    expect(result.result.status.state).toBe("working");
    const taskId = result.result.id;

    const status = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      event,
      customHandler,
    );

    expect(status.error).toBeUndefined();
    expect(status.result.status.state).toBe("failed");
    expect(status.result.status.message.parts[0].text).toContain(
      "dispatch kept failing",
    );
  });

  it("fails a processing async task past the processing lifetime cap even though the heartbeat kept it fresh", async () => {
    let started: (value: unknown) => void = () => {};
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    const handler = vi.fn(async () => {
      started(undefined);
      return new Promise<never>(() => {});
    });
    const sideEffectConfig: A2AConfig = {
      ...customHandler,
      handler,
    };
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            testUpdatedAt: Date.now(),
            testCreatedAt: Date.now() - 30 * 60 * 1000 - 1,
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "create something" }],
          },
        },
      },
      event,
      sideEffectConfig,
    );
    expect(result.error).toBeUndefined();
    const taskId = result.result.id;

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    void processA2ATaskFromQueue(taskId, sideEffectConfig);
    await startedPromise;

    const status = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      event,
      sideEffectConfig,
    );

    expect(status.error).toBeUndefined();
    expect(status.result.status.state).toBe("failed");
    expect(status.result.status.message.parts[0].text).toContain(
      "maximum run time",
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps the lifetime failure terminal when the original processor later completes", async () => {
    let started: (value: unknown) => void = () => {};
    const startedPromise = new Promise((resolve) => {
      started = resolve;
    });
    let release: (value: unknown) => void = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      started(undefined);
      await gate;
      return {
        message: {
          role: "agent" as const,
          parts: [{ type: "text" as const, text: "late success" }],
        },
      };
    });
    const config: A2AConfig = { ...customHandler, handler };
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            testUpdatedAt: Date.now(),
            testCreatedAt: Date.now() - 30 * 60 * 1000 - 1,
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "create something" }],
          },
        },
      },
      event,
      config,
    );
    const taskId = result.result.id;
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    const processorPromise = processA2ATaskFromQueue(taskId, config);
    await startedPromise;

    const timedOut = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      event,
      config,
    );
    expect(timedOut.result.status.state).toBe("failed");

    release(undefined);
    await processorPromise;
    const afterLateCompletion = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tasks/get",
        params: { id: taskId },
      },
      event,
      config,
    );
    expect(afterLateCompletion.result.status.state).toBe("failed");
    expect(afterLateCompletion.result.status.message.parts[0].text).toContain(
      "maximum run time",
    );
    expect(afterLateCompletion.result.history).not.toContainEqual({
      role: "agent",
      parts: [{ type: "text", text: "late success" }],
    });
  });

  it("returns false without an unhandled rejection when refire dispatch keeps throwing", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            testUpdatedAt: Date.now() - 11_000,
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        },
      },
      event,
      customHandler,
    );
    expect(result.error).toBeUndefined();
    const taskId = result.result.id;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const status = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      event,
      customHandler,
    );

    expect(status.error).toBeUndefined();
    expect(status.result.status.state).toBe("working");
  });

  it("refuses async message/send on hosted runtimes without A2A_SECRET", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousNetlify = process.env.NETLIFY;
    const previousNetlifyLocal = process.env.NETLIFY_LOCAL;
    const previousA2ASecret = process.env.A2A_SECRET;
    try {
      process.env.NODE_ENV = "development";
      process.env.NETLIFY = "true";
      delete process.env.NETLIFY_LOCAL;
      delete process.env.A2A_SECRET;

      const event = mockEvent();
      const result = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "message/send",
          params: {
            async: true,
            message: {
              role: "user",
              parts: [{ type: "text", text: "go" }],
            },
          },
        },
        event,
        customHandler,
      );

      expect(result.error).toMatchObject({
        code: -32001,
        message:
          "A2A async mode requires A2A_SECRET for internal processor dispatch; apiKeyEnv only supports synchronous A2A.",
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousNetlify === undefined) delete process.env.NETLIFY;
      else process.env.NETLIFY = previousNetlify;
      if (previousNetlifyLocal === undefined) delete process.env.NETLIFY_LOCAL;
      else process.env.NETLIFY_LOCAL = previousNetlifyLocal;
      if (previousA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = previousA2ASecret;
    }
  });

  it("does not leave legacy apiKeyEnv async tasks polling forever", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousNetlify = process.env.NETLIFY;
    const previousNetlifyLocal = process.env.NETLIFY_LOCAL;
    const previousA2ASecret = process.env.A2A_SECRET;
    const previousApiKey = process.env.TEST_A2A_API_KEY;
    try {
      process.env.NODE_ENV = "development";
      process.env.NETLIFY = "true";
      delete process.env.NETLIFY_LOCAL;
      delete process.env.A2A_SECRET;
      process.env.TEST_A2A_API_KEY = "test-api-key";

      const result = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "message/send",
          params: {
            async: true,
            message: {
              role: "user",
              parts: [{ type: "text", text: "go" }],
            },
          },
        },
        mockEvent(),
        { ...customHandler, apiKeyEnv: "TEST_A2A_API_KEY" },
      );

      expect(result).toMatchObject({
        error: {
          code: -32001,
          message:
            "A2A async mode requires A2A_SECRET for internal processor dispatch; apiKeyEnv only supports synchronous A2A.",
        },
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousNetlify === undefined) delete process.env.NETLIFY;
      else process.env.NETLIFY = previousNetlify;
      if (previousNetlifyLocal === undefined) delete process.env.NETLIFY_LOCAL;
      else process.env.NETLIFY_LOCAL = previousNetlifyLocal;
      if (previousA2ASecret === undefined) delete process.env.A2A_SECRET;
      else process.env.A2A_SECRET = previousA2ASecret;
      if (previousApiKey === undefined) delete process.env.TEST_A2A_API_KEY;
      else process.env.TEST_A2A_API_KEY = previousApiKey;
    }
  });

  it("passes the processor H3 event through async handler context", async () => {
    let processorEvent: any;
    let processingAttemptId: string | undefined;
    const eventAwareConfig: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => {
        processingAttemptId = context.processingAttemptId;
        return {
          message: {
            role: "agent",
            parts: [
              {
                type: "text",
                text:
                  context.event === processorEvent
                    ? "event-present"
                    : "event-missing",
              },
            ],
          },
        };
      },
    };
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        },
      },
      event,
      eventAwareConfig,
    );
    expect(result.error).toBeUndefined();
    const taskId = result.result.id;

    processorEvent = mockEvent();
    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(taskId, eventAwareConfig, processorEvent);
    expect(processingAttemptId).toBe("1");

    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      mockEvent(),
      eventAwareConfig,
    );
    expect(followup.error).toBeUndefined();
    expect(followup.result.status.message.parts[0].text).toBe("event-present");
  });

  it("refuses async A2A without A2A_SECRET when the unsigned handoff would leave this machine", async () => {
    vi.stubEnv("A2A_SECRET", "");
    vi.stubEnv("FUSION_POD_UID", "");
    vi.stubEnv("FUSION_ENVIRONMENT", "");
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const event = mockEvent();
    event.node.req = { headers: { host: "abc.tunnel.example" } };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: { role: "user", parts: [{ type: "text", text: "go" }] },
        },
      },
      event,
      customHandler,
    );

    expect(result.error).toEqual({
      code: -32001,
      message:
        "A2A async mode requires A2A_SECRET for internal processor dispatch; apiKeyEnv only supports synchronous A2A.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("self-dispatches async A2A tasks under APP_BASE_PATH", async () => {
    vi.stubEnv("A2A_SECRET", "test-secret-at-least-32-characters-long");
    process.env.APP_BASE_PATH = "/docs";
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const event = mockEvent();
    event.node.req = {
      headers: {
        host: "app.test",
        "x-forwarded-proto": "https",
      },
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        },
      },
      event,
      customHandler,
    );

    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/docs/_agent-native/a2a/_process-task",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("routes env-opted-in async A2A tasks through the Netlify durable background worker", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("AGENT_CHAT_DURABLE_BACKGROUND", "true");
    vi.stubEnv("A2A_SECRET", "test-secret-at-least-32-characters-long");
    vi.stubEnv("APP_BASE_PATH", "/docs");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const event = mockEvent();
    event.node.req = {
      headers: {
        host: "app.test",
        "x-forwarded-proto": "https",
      },
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        },
      },
      event,
      customHandler,
    );

    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/.netlify/functions/server-agent-background",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          taskId: result.result.id,
          __agentNativeProcessor: "a2a",
        }),
      }),
    );
  });

  it("falls back to the portable processor when the durable worker rejects dispatch", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("AGENT_CHAT_DURABLE_BACKGROUND", "true");
    vi.stubEnv("A2A_SECRET", "test-secret-at-least-32-characters-long");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response("accepted"));
    vi.stubGlobal("fetch", fetchMock);

    const event = mockEvent();
    event.node.req = {
      headers: {
        host: "app.test",
        "x-forwarded-proto": "https",
      },
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "go" }],
          },
        },
      },
      event,
      { ...customHandler, durableBackgroundRuns: true },
    );

    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://app.test/.netlify/functions/server-agent-background",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://app.test/_agent-native/a2a/_process-task",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("does not trust unauthenticated caller metadata for A2A request context", async () => {
    resolveOrgByDomainMock.mockResolvedValue({ orgId: "org-reassigned" });
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `${getRequestUserEmail() ?? "none"}|${getRequestOrgId() ?? "none"}`,
            },
          ],
        },
      }),
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            userEmail: "mallory+qa@agent-native.example.com",
            orgDomain: "acme.test",
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      mockEvent(),
      contextConfig,
    );

    expect(result.error).toBeUndefined();
    expect(result.result.status.message.parts[0].text).toBe("none|none");
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
  });

  it("uses verified A2A event identity for request context", async () => {
    resolveOrgByDomainMock.mockResolvedValue({ orgId: "acme" });
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `${getRequestUserEmail() ?? "none"}|${getRequestOrgId() ?? "none"}`,
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aOrgDomain: "acme.test",
      __a2aVerifiedOrgId: "org-acme",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            userEmail: "mallory+qa@agent-native.example.com",
            orgDomain: "evil.test",
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      contextConfig,
    );

    expect(result.error).toBeUndefined();
    expect(result.result.status.message.parts[0].text).toBe(
      "alice+qa@agent-native.example.com|org-acme",
    );
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "keeps the verified org-secret binding for async=%s",
    async (asyncMode) => {
      resolveOrgByDomainMock.mockRejectedValue(
        new Error("org registry became unavailable"),
      );
      resolveOrgIdForEmailMock.mockResolvedValue("org-y");
      const contextConfig: A2AConfig = {
        ...customHandler,
        handler: async () => ({
          message: {
            role: "agent",
            parts: [
              {
                type: "text",
                text: `${getRequestUserEmail() ?? "none"}|${getRequestOrgId() ?? "none"}`,
              },
            ],
          },
        }),
      };
      const event = mockEvent();
      event.context = {
        __a2aVerifiedEmail: "alice@x.example",
        __a2aOrgDomain: "x.example",
        __a2aVerifiedOrgId: "org-x",
      };

      const result = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "message/send",
          params: {
            async: asyncMode,
            message: { role: "user", parts: [{ type: "text", text: "hi" }] },
          },
        },
        event,
        contextConfig,
      );

      expect(result.error).toBeUndefined();
      if (asyncMode) {
        const { processA2ATaskFromQueue } = await import("./handlers.js");
        await processA2ATaskFromQueue(result.result.id, contextConfig);
      }
      const followup = await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tasks/get",
          params: { id: result.result.id },
        },
        event,
        contextConfig,
      );

      expect(followup.result.status.message.parts[0].text).toBe(
        "alice@x.example|org-x",
      );
      if (asyncMode) {
        const { getTask } = await import("./task-store.js");
        expect(
          (await getTask(result.result.id))?.metadata?.__a2a_processor,
        ).toEqual(expect.objectContaining({ verifiedOrgId: "org-x" }));
      }
      expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
      expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
    },
  );

  it("restores the queued caller origin without trusting it for identity", async () => {
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `${getRequestUserEmail() ?? "none"}|${getRequestContext()?.requestOrigin ?? "none"}`,
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };
    event.req = {
      headers: new Headers({
        host: "workspace.example.test",
        "x-forwarded-proto": "https",
      }),
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: { requestOrigin: "https://attacker.example.test" },
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      contextConfig,
    );
    expect(result.error).toBeUndefined();

    const { getTask } = await import("./task-store.js");
    expect(
      (await getTask(result.result.id))?.metadata?.__a2a_processor,
    ).toEqual(
      expect.objectContaining({
        requestOrigin: "https://workspace.example.test",
      }),
    );
    expect(result.result.metadata?.__a2a_processor).toBeUndefined();

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(result.result.id, contextConfig);

    const followupEvent = mockEvent();
    followupEvent.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };
    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: result.result.id },
      },
      followupEvent,
      contextConfig,
    );
    expect(followup.result.status.message.parts[0].text).toBe(
      "alice+qa@agent-native.example.com|https://workspace.example.test",
    );
  });

  it("drops request-supplied approvals across an authenticated async processor hop", async () => {
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: JSON.stringify(
                "approvedActions" in context ? "present" : [],
              ),
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = { __a2aVerifiedEmail: "alice+qa@agent-native.example.com" };
    const approvedActions = [
      { tool: "send-email", input: { to: "alice@example.org" } },
    ];

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          approvedActions,
          message: { role: "user", parts: [{ type: "text", text: "send" }] },
        },
      },
      event,
      contextConfig,
    );

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(result.result.id, contextConfig);
    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: result.result.id },
      },
      event,
      contextConfig,
    );
    expect(JSON.parse(followup.result.status.message.parts[0].text)).toEqual(
      [],
    );
    expect(followup.result.metadata?.__a2a_processor).toBeUndefined();
  });

  it("preserves verified Slack source context across an async processor hop", async () => {
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: JSON.stringify(context.sourceContext ?? null),
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aAudienceVerified: true,
    };
    const sourceContext = {
      platform: "slack",
      sourceUrl: "https://example-workspace.slack.com/archives/C123/p123456",
    };
    const sourceReference = {
      platform: "slack",
      integrationTaskId: "integration-task-1",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: { sourceContext: sourceReference },
          message: {
            role: "user",
            parts: [{ type: "text", text: "capture" }],
          },
        },
      },
      event,
      contextConfig,
    );

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(result.result.id, contextConfig);
    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: result.result.id },
      },
      event,
      contextConfig,
    );

    expect(JSON.parse(followup.result.status.message.parts[0].text)).toEqual(
      sourceContext,
    );
    expect(followup.result.metadata?.sourceContext).toBeUndefined();
    expect(followup.result.metadata?.__a2a_processor).toBeUndefined();
  });

  it("drops raw approval payloads before the synchronous handler", async () => {
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: JSON.stringify(
                "approvedActions" in context ? "present" : [],
              ),
            },
          ],
        },
      }),
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          approvedActions: [
            { tool: "send-email", input: { to: "victim@example.org" } },
          ],
          message: { role: "user", parts: [{ type: "text", text: "send" }] },
        },
      },
      mockEvent(),
      contextConfig,
    );

    expect(result.result.status.message.parts[0].text).toBe("[]");
  });

  it("captures the inbound origin for legacy async callers without metadata", async () => {
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: getRequestContext()?.requestOrigin ?? "none",
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };
    event.req = {
      headers: new Headers({
        host: "legacy.example.test",
        "x-forwarded-proto": "https",
      }),
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      contextConfig,
    );
    expect(result.error).toBeUndefined();

    const { getTask } = await import("./task-store.js");
    expect(
      (await getTask(result.result.id))?.metadata?.__a2a_processor,
    ).toEqual(
      expect.objectContaining({
        requestOrigin: "https://legacy.example.test",
      }),
    );

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(result.result.id, contextConfig);

    const followupEvent = mockEvent();
    followupEvent.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };
    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: result.result.id },
      },
      followupEvent,
      contextConfig,
    );
    expect(followup.result.status.message.parts[0].text).toBe(
      "https://legacy.example.test",
    );
  });

  it("carries org-member assurance through an async processor hop", async () => {
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: getRequestContext()?.a2aIdentityAssurance ?? "none",
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "owner@builder.io",
      __a2aVerifiedOrgId: "org-builder",
      __a2aOrgDomain: "builder.io",
      __a2aIdentityAssurance: "org-member",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      },
      event,
      contextConfig,
    );
    expect(result.error).toBeUndefined();

    const { getTask } = await import("./task-store.js");
    expect(
      (await getTask(result.result.id))?.metadata?.__a2a_processor,
    ).toMatchObject({ identityAssurance: "org-member" });

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(result.result.id, contextConfig);

    const followupEvent = mockEvent();
    followupEvent.context = {
      __a2aVerifiedEmail: "owner@builder.io",
      __a2aVerifiedOrgId: "org-builder",
      __a2aOrgDomain: "builder.io",
      __a2aIdentityAssurance: "org-member",
    };
    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: result.result.id },
      },
      followupEvent,
      contextConfig,
    );

    expect(followup.result.status.message.parts[0].text).toBe("org-member");
  });

  it("keeps a verified identity without an org id in personal scope", async () => {
    resolveOrgIdForEmailMock.mockResolvedValue("org-by-email");
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `${getRequestUserEmail() ?? "none"}|${getRequestOrgId() ?? "none"}`,
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            userEmail: "mallory+qa@agent-native.example.com",
            orgDomain: "evil.test",
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      contextConfig,
    );

    expect(result.error).toBeUndefined();
    expect(result.result.status.message.parts[0].text).toBe(
      "alice+qa@agent-native.example.com|none",
    );
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("does not trust forged org metadata when async A2A processor reconstructs context", async () => {
    resolveOrgByDomainMock.mockResolvedValue({ orgId: "acme" });
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `${getRequestUserEmail() ?? "none"}|${getRequestOrgId() ?? "none"}`,
            },
          ],
        },
      }),
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            userEmail: "mallory+qa@agent-native.example.com",
            orgDomain: "acme.test",
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      mockEvent(),
      contextConfig,
    );
    expect(result.error).toBeUndefined();
    const taskId = result.result.id;

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(taskId, contextConfig);

    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      mockEvent(),
      contextConfig,
    );

    expect(followup.error).toBeUndefined();
    expect(followup.result.status.message.parts[0].text).toBe("none|none");
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("keeps async identities without an org id in personal scope", async () => {
    resolveOrgIdForEmailMock.mockResolvedValue("org-by-email");
    const contextConfig: A2AConfig = {
      ...customHandler,
      handler: async () => ({
        message: {
          role: "agent",
          parts: [
            {
              type: "text",
              text: `${getRequestUserEmail() ?? "none"}|${getRequestOrgId() ?? "none"}`,
            },
          ],
        },
      }),
    };
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            userEmail: "mallory+qa@agent-native.example.com",
            orgDomain: "evil.test",
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      },
      event,
      contextConfig,
    );
    expect(result.error).toBeUndefined();
    const taskId = result.result.id;

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    await processA2ATaskFromQueue(taskId, contextConfig);

    const getEvent = mockEvent();
    getEvent.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
    };
    const followup = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id: taskId },
      },
      getEvent,
      contextConfig,
    );

    expect(followup.error).toBeUndefined();
    expect(followup.result.status.message.parts[0].text).toBe(
      "alice+qa@agent-native.example.com|none",
    );
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });
});

describe("default handler (no custom handler)", () => {
  const defaultConfig: A2AConfig = {
    name: "Default Agent",
    description: "Uses default handler",
    skills: [{ id: "s1", name: "Skill", description: "A skill" }],
  };

  it("delegates to agentChat.call when no handler provided", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");

    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "what events today?" }],
          },
        },
      },
      event,
      defaultConfig,
    );

    expect(agentChat.call).toHaveBeenCalledWith("what events today?");
    expect(result.error).toBeUndefined();
    const task = result.result;
    expect(task.status.state).toBe("completed");
    expect(task.status.message.parts[0].text).toBe("Agent says hello");
    expect(task.artifacts).toHaveLength(1);
    expect(task.artifacts[0].name).toBe("files-changed");
    expect(task.artifacts[0].parts[0].data.files).toEqual(["events.json"]);
  });

  it("refuses the default chat handoff for a service principal", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");
    vi.mocked(agentChat.call).mockClear();
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "svc-ci@service.org-acme",
      __a2aVerifiedOrgId: "org-acme",
      __a2aServicePrincipalAllowedActions: ["read-*"],
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "read records" }],
          },
        },
      },
      event,
      defaultConfig,
    );

    expect(agentChat.call).not.toHaveBeenCalled();
    expect(result.error.message).toContain(
      "cannot preserve service-principal authorization",
    );
    expect(recordServicePrincipalDenialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "a2a:agent-chat-handoff",
        caller: "a2a",
        orgId: "org-acme",
        error: expect.objectContaining({
          statusCode: 403,
          errorCode: "service_principal_handoff_unsupported",
        }),
      }),
    );
  });

  it("does not audit a default handoff under an unverified service org", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");
    vi.mocked(agentChat.call).mockClear();
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "svc-ci@service.org-acme",
      __a2aServicePrincipalAllowedActions: ["read-*"],
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 34,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "read records" }],
          },
        },
      },
      event,
      defaultConfig,
    );

    expect(agentChat.call).not.toHaveBeenCalled();
    expect(recordServicePrincipalDenialMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionName: "a2a:agent-chat-handoff",
        orgId: undefined,
      }),
    );
  });

  it("provides verified Slack source metadata as hidden agent context", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aAudienceVerified: true,
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            sourceContext: {
              platform: "slack",
              integrationTaskId: "integration-task-1",
            },
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "capture this" }],
          },
        },
      },
      event,
      defaultConfig,
    );

    expect(agentChat.call).toHaveBeenCalledWith("capture this", {
      context: expect.stringContaining(
        '"sourceUrl":"https://example-workspace.slack.com/archives/C123/p123456"',
      ),
    });
    expect(callActionMock).toHaveBeenCalledWith(
      "https://dispatch.agent-native.test",
      "resolve-integration-source-context",
      { integrationTaskId: "integration-task-1" },
      expect.objectContaining({
        userEmail: "alice+qa@agent-native.example.com",
        requestTimeoutMs: 5_000,
      }),
    );
  });

  it("drops Slack source metadata when its domain no longer maps to the verified org id", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");
    vi.mocked(agentChat.call).mockClear();
    callActionMock.mockClear();
    resolveA2AOrganizationCredentialsByDomainMock.mockResolvedValue({
      orgId: "org-reassigned",
      orgDomain: "shared.test",
      secret: "test-secret",
    });
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aAudienceVerified: true,
      __a2aOrgDomain: "shared.test",
      __a2aVerifiedOrgId: "org-acme",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "message/send",
        params: {
          metadata: {
            sourceContext: {
              platform: "slack",
              integrationTaskId: "integration-task-1",
            },
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "capture this" }],
          },
        },
      },
      event,
      {
        ...defaultConfig,
        handler: async (_message, context) => ({
          message: {
            role: "agent",
            parts: [
              {
                type: "text",
                text: JSON.stringify(context.sourceContext ?? null),
              },
            ],
          },
        }),
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.result.status.message.parts[0].text).toBe("null");
    expect(callActionMock).not.toHaveBeenCalled();
    expect(resolveA2AOrganizationCredentialsByDomainMock).toHaveBeenCalledWith(
      "shared.test",
    );
    expect(getA2ASecretByDomainMock).not.toHaveBeenCalled();
  });

  it("rejects an opaque source reference from a verified but audience-unbound token", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");
    vi.mocked(agentChat.call).mockClear();
    callActionMock.mockClear();
    const event = mockEvent();
    event.context = { __a2aVerifiedEmail: "alice+qa@agent-native.example.com" };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            sourceContext: {
              platform: "slack",
              integrationTaskId: "integration-task-1",
            },
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "capture this" }],
          },
        },
      },
      event,
      defaultConfig,
    );

    expect(callActionMock).not.toHaveBeenCalled();
    expect(agentChat.call).toHaveBeenCalledWith("capture this");
  });

  it.each([
    {
      label: "an unsigned caller",
      verified: false,
      sourceContext: {
        platform: "slack",
        integrationTaskId: "integration-task-1",
      },
    },
    {
      label: "legacy caller-supplied Slack URL metadata",
      verified: true,
      sourceContext: {
        platform: "slack",
        sourceUrl: "https://example-workspace.slack.com/archives/C123/p123456",
      },
    },
    {
      label: "a non-Slack platform",
      verified: true,
      sourceContext: {
        platform: "email",
        integrationTaskId: "integration-task-1",
      },
    },
  ])(
    "rejects source context from $label",
    async ({ verified, sourceContext }) => {
      const { agentChat } = await import("../shared/agent-chat.js");
      vi.mocked(agentChat.call).mockClear();
      const event = mockEvent();
      if (verified) {
        event.context = {
          __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
          __a2aAudienceVerified: true,
        };
      }

      await handleJsonRpc(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "message/send",
          params: {
            metadata: { sourceContext },
            message: {
              role: "user",
              parts: [{ type: "text", text: "capture this" }],
            },
          },
        },
        event,
        defaultConfig,
      );

      expect(agentChat.call).toHaveBeenCalledWith("capture this");
    },
  );

  it("fails closed when Dispatch cannot verify the referenced integration task", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");
    vi.mocked(agentChat.call).mockClear();
    callActionMock.mockResolvedValueOnce({
      action: "resolve-integration-source-context",
      status: "completed",
      output: "null",
    });
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice+qa@agent-native.example.com",
      __a2aAudienceVerified: true,
    };

    await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            sourceContext: {
              platform: "slack",
              integrationTaskId: "forged-task-id",
            },
            callerApp: "dispatch",
          },
          message: {
            role: "user",
            parts: [{ type: "text", text: "capture this" }],
          },
        },
      },
      event,
      defaultConfig,
    );

    expect(agentChat.call).toHaveBeenCalledWith("capture this");
  });

  it("handles empty text message gracefully", async () => {
    const event = mockEvent();
    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "data", data: { key: "val" } }],
          },
        },
      },
      event,
      defaultConfig,
    );

    const task = result.result;
    expect(task.status.state).toBe("completed");
    expect(task.status.message.parts[0].text).toBe(
      "No text content in message",
    );
  });
});

describe("A2A action call hooks on direct action calls", () => {
  const baseConfig: A2AConfig = {
    name: "Hook Agent",
    description: "Test",
    skills: [],
    handler: async () => ({
      message: { role: "agent", parts: [{ type: "text", text: "ok" }] },
    }),
  };
  const verifiedEvent = (context: Record<string, unknown> = {}) => {
    const event = mockEvent();
    event.context = {
      __a2aVerifiedEmail: "alice@example.test",
      __a2aAudienceVerified: true,
      __a2aIdentityAssurance: "user",
      __a2aVerifiedAudiences: ["https://peer.example.test"],
      ...context,
    };
    event.req = new Request("https://app.example.test/_agent-native/a2a", {
      method: "POST",
    });
    return event;
  };
  const probe = vi.fn(async () => ({
    status: "completed" as const,
    output: JSON.stringify({
      interactive: isProviderInteractiveScope(),
      foreground: isA2AForegroundCall(),
      orgId: getRequestOrgId() ?? null,
    }),
  }));
  const invoke = (event: any, params: Record<string, unknown> = {}) =>
    handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "actions/invoke",
        params: { action: "read", input: { q: 1 }, ...params },
      },
      event,
      { ...baseConfig, executeReadOnlyAction: probe },
    );

  afterEach(() => {
    clearA2AActionCallHooksForTests();
    probe.mockClear();
  });

  it("runs the action as before when no hook is registered", async () => {
    const result = await invoke(verifiedEvent(), { proof: "ignored" });
    expect(result.error).toBeUndefined();
    expect(JSON.parse(result.result.output)).toEqual({
      interactive: false,
      foreground: false,
      orgId: null,
    });
  });

  it("gives the hook the verified caller and the received params", async () => {
    const incoming = vi.fn(() => undefined);
    registerA2AActionCallHook({ id: "spy", incoming });
    await invoke(verifiedEvent(), { proof: "p1" });
    expect(incoming).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "read",
        input: { q: 1 },
        params: expect.objectContaining({ proof: "p1" }),
        caller: {
          email: "alice@example.test",
          identityAssurance: "user",
          audiences: ["https://peer.example.test"],
        },
      }),
    );
    expect(probe).toHaveBeenCalledOnce();
  });

  it("returns a typed refusal and does not run the action", async () => {
    registerA2AActionCallHook({
      id: "gate",
      incoming: () => ({
        status: "refused",
        message: "Invalid proof",
        reason: "bad-proof",
      }),
    });
    const result = await invoke(verifiedEvent());
    expect(result.error).toEqual({
      code: -32001,
      message: "Invalid proof",
      data: {
        kind: A2A_CALL_REFUSED_KIND,
        hookId: "gate",
        reason: "bad-proof",
      },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("fails the call loudly when a hook throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    registerA2AActionCallHook({
      id: "broken",
      incoming: () => {
        throw new Error("store down");
      },
    });
    const result = await invoke(verifiedEvent());
    expect(result.error).toMatchObject({
      code: -32000,
      message: "A2A call hook failed",
    });
    expect(probe).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("runs an admitted foreground call inside an interactive scope", async () => {
    registerA2AActionCallHook({
      id: "fg",
      incoming: () => ({
        status: "admitted",
        foreground: { expiresAt: Date.now() + 30_000 },
      }),
    });
    const result = await invoke(verifiedEvent());
    expect(JSON.parse(result.result.output)).toMatchObject({
      interactive: true,
      foreground: true,
    });
  });

  it("refuses an admission that has already expired", async () => {
    registerA2AActionCallHook({
      id: "fg",
      incoming: () => ({
        status: "admitted",
        foreground: { expiresAt: Date.now() - 1 },
      }),
    });
    const result = await invoke(verifiedEvent());
    expect(result.error?.data).toMatchObject({ reason: "foreground-expired" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("refuses an admission longer than a timer can hold instead of aborting it at once", async () => {
    registerA2AActionCallHook({
      id: "fg",
      incoming: () => ({
        status: "admitted",
        foreground: { expiresAt: Date.now() + 2 ** 31 + 60_000 },
      }),
    });
    const result = await invoke(verifiedEvent());
    expect(result.error?.data).toMatchObject({ reason: "foreground-too-long" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("binds only the verified organization", async () => {
    registerA2AActionCallHook({
      id: "org",
      incoming: () => ({ status: "admitted", orgId: "org-other" }),
    });
    const mismatch = await invoke(
      verifiedEvent({ __a2aVerifiedOrgId: "org-verified" }),
    );
    expect(mismatch.error?.data).toMatchObject({ reason: "org-mismatch" });
    expect(probe).not.toHaveBeenCalled();

    clearA2AActionCallHooksForTests();
    registerA2AActionCallHook({
      id: "org",
      incoming: () => ({ status: "admitted", orgId: "org-verified" }),
    });
    const same = await invoke(
      verifiedEvent({ __a2aVerifiedOrgId: "org-verified" }),
    );
    expect(JSON.parse(same.result.output)).toMatchObject({
      orgId: "org-verified",
    });
  });
});
