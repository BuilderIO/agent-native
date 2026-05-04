import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleJsonRpcH3 as handleJsonRpc } from "./handlers.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import type { A2AConfig, Message } from "./types.js";

const resolveOrgByDomainMock = vi.hoisted(() => vi.fn());
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn());

// Mock h3's setResponseStatus and setResponseHeader
vi.mock("h3", () => ({
  setResponseStatus: (event: any, code: number) => {
    event._status = code;
  },
  setResponseHeader: (event: any, key: string, val: string) => {
    event._headers[key] = val;
  },
}));

// Mock task-store (now async/SQL-backed)
vi.mock("./task-store.js", () => {
  let tasks: Record<string, any> = {};
  let counter = 0;
  return {
    async createTask(
      message: Message,
      contextId?: string,
      metadata?: Record<string, unknown>,
      ownerEmail?: string | null,
    ) {
      const id = `task-${++counter}`;
      const task = {
        id,
        contextId,
        status: { state: "submitted", timestamp: new Date().toISOString() },
        history: [message],
        artifacts: [],
        metadata,
        ownerEmail: ownerEmail ?? null,
        updatedAt: Date.now(),
      };
      tasks[id] = task;
      return task;
    },
    async getTask(id: string) {
      return tasks[id] ?? null;
    },
    async getTaskOwner(id: string) {
      const task = tasks[id];
      if (!task) return null;
      return task.ownerEmail ?? null;
    },
    async updateTask(id: string, update: any) {
      const task = tasks[id];
      if (!task) return null;
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
    async resetStuckA2ATaskForRetry() {
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
  };
});

// Mock the integrations/internal-token import so the a2a handler tests don't
// require A2A_SECRET to be set in the test environment for sign().
vi.mock("../integrations/internal-token.js", () => ({
  signInternalToken: () => "test-token",
  verifyInternalToken: () => true,
  extractBearerToken: (h?: string) => h?.replace(/^Bearer\s+/i, "") ?? null,
}));

// Mock agentChat.call for default handler tests
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
  resolveOrgByDomain: resolveOrgByDomainMock,
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

/** Create a mock H3 event for testing handleJsonRpcH3 */
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
    resolveOrgByDomainMock.mockReset();
    resolveOrgIdForEmailMock.mockReset();
  });

  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
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
    // Handler resolves only when we let it — so if the response came back
    // synchronously the task could not yet be 'completed'.
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

    // Returned immediately, before the handler resolved. The dispatcher
    // self-fires a POST to /_process-task on the same deployment — in the
    // real wire-up `mountA2A` mounts that route and calls
    // `processA2ATaskFromQueue` in a fresh function execution. Here we
    // invoke it directly to simulate that next request.
    expect(result.error).toBeUndefined();
    expect(result.result.status.state).toBe("working");
    const taskId = result.result.id;

    const { processA2ATaskFromQueue } = await import("./handlers.js");
    const processorPromise = processA2ATaskFromQueue(taskId, slowConfig);

    // Now let the handler finish, and verify the task progresses to completed
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

  it("refuses async message/send on hosted runtimes without A2A auth config", async () => {
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
          "A2A async mode is not available — A2A_SECRET or apiKeyEnv must be configured.",
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

  it("passes the processor H3 event through async handler context", async () => {
    let processorEvent: any;
    const eventAwareConfig: A2AConfig = {
      ...customHandler,
      handler: async (_message, context) => ({
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
      }),
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

  it("self-dispatches async A2A tasks under APP_BASE_PATH", async () => {
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

  it("does not trust unauthenticated caller metadata for A2A request context", async () => {
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
          metadata: {
            userEmail: "mallory+qa@agent-native.test",
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
      __a2aVerifiedEmail: "alice+qa@agent-native.test",
      __a2aOrgDomain: "acme.test",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            userEmail: "mallory+qa@agent-native.test",
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
      "alice+qa@agent-native.test|acme",
    );
    expect(resolveOrgByDomainMock).toHaveBeenCalledWith("acme.test");
    expect(resolveOrgByDomainMock).not.toHaveBeenCalledWith("evil.test");
    expect(resolveOrgIdForEmailMock).not.toHaveBeenCalled();
  });

  it("resolves org context from verified email when no verified org domain is present", async () => {
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
      __a2aVerifiedEmail: "alice+qa@agent-native.test",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          metadata: {
            userEmail: "mallory+qa@agent-native.test",
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
      "alice+qa@agent-native.test|org-by-email",
    );
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).toHaveBeenCalledWith(
      "alice+qa@agent-native.test",
    );
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
            userEmail: "mallory+qa@agent-native.test",
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

  it("resolves org context from verified email in async A2A processor", async () => {
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
      __a2aVerifiedEmail: "alice+qa@agent-native.test",
    };

    const result = await handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          async: true,
          metadata: {
            userEmail: "mallory+qa@agent-native.test",
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
      __a2aVerifiedEmail: "alice+qa@agent-native.test",
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
      "alice+qa@agent-native.test|org-by-email",
    );
    expect(resolveOrgByDomainMock).not.toHaveBeenCalled();
    expect(resolveOrgIdForEmailMock).toHaveBeenCalledWith(
      "alice+qa@agent-native.test",
    );
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
