import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleJsonRpcH3 as handleJsonRpc } from "./handlers.js";
import type { A2AConfig, Message } from "./types.js";

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
    ) {
      const id = `task-${++counter}`;
      const task = {
        id,
        contextId,
        status: { state: "submitted", timestamp: new Date().toISOString() },
        history: [message],
        artifacts: [],
        metadata,
      };
      tasks[id] = task;
      return task;
    },
    async getTask(id: string) {
      return tasks[id] ?? null;
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
      return task;
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
