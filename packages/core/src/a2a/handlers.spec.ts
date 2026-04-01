import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleJsonRpc } from "./handlers.js";
import type { A2AConfig, Message } from "./types.js";

// Mock task-store (now async/SQL-backed)
vi.mock("./task-store.js", () => {
  let tasks: Record<string, any> = {};
  let counter = 0;
  return {
    async createTask(message: Message, contextId?: string) {
      const id = `task-${++counter}`;
      const task = {
        id,
        contextId,
        status: { state: "submitted", timestamp: new Date().toISOString() },
        history: [message],
        artifacts: [],
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
  };
});

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

function mockReq(body: any): any {
  return { body };
}

function mockRes(): any {
  const res: any = {
    _status: 200,
    _json: null,
    _headers: {} as Record<string, string>,
    _writes: [] as string[],
    _ended: false,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: any) {
      res._json = data;
    },
    setHeader(key: string, val: string) {
      res._headers[key] = val;
    },
    write(data: string) {
      res._writes.push(data);
    },
    end() {
      res._ended = true;
    },
  };
  return res;
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
    const res = mockRes();
    await handleJsonRpc(mockReq({}), res, customHandler);
    expect(res._status).toBe(400);
    expect(res._json.error.code).toBe(-32600);
  });

  it("rejects unknown methods", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({ jsonrpc: "2.0", id: 1, method: "unknown/method" }),
      res,
      customHandler,
    );
    expect(res._json.error.code).toBe(-32601);
    expect(res._json.error.message).toContain("unknown/method");
  });

  it("handles message/send with custom handler", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
        },
      }),
      res,
      customHandler,
    );
    expect(res._json.error).toBeUndefined();
    expect(res._json.id).toBe(1);
    const task = res._json.result;
    expect(task.status.state).toBe("completed");
    expect(task.status.message.parts[0].text).toBe("custom response");
  });

  it("handles message/send with invalid message", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: {} },
      }),
      res,
      customHandler,
    );
    expect(res._json.error).toBeDefined();
    expect(res._json.error.code).toBe(-32602);
  });

  it("handles handler errors gracefully", async () => {
    const failConfig: A2AConfig = {
      ...customHandler,
      handler: async () => {
        throw new Error("handler exploded");
      },
    };
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      }),
      res,
      failConfig,
    );
    expect(res._json.error.code).toBe(-32000);
    expect(res._json.error.message).toBe("handler exploded");
  });

  it("rejects streaming when not enabled", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "message/stream",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "hi" }],
          },
        },
      }),
      res,
      { ...customHandler, streaming: false },
    );
    expect(res._json.error.code).toBe(-32601);
  });

  it("handles tasks/get for unknown task", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: { id: "nonexistent" },
      }),
      res,
      customHandler,
    );
    expect(res._json.error.code).toBe(-32001);
  });

  it("handles tasks/get without id", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: {},
      }),
      res,
      customHandler,
    );
    expect(res._json.error.code).toBe(-32602);
  });

  it("handles tasks/cancel without id", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/cancel",
        params: {},
      }),
      res,
      customHandler,
    );
    expect(res._json.error.code).toBe(-32602);
  });
});

describe("default handler (no custom handler)", () => {
  const defaultConfig: A2AConfig = {
    name: "Default Agent",
    description: "Uses default handler",
    skills: [{ id: "s1", name: "Skill", description: "A skill" }],
    // No handler — should use defaultHandler
  };

  it("delegates to agentChat.call when no handler provided", async () => {
    const { agentChat } = await import("../shared/agent-chat.js");

    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "text", text: "what events today?" }],
          },
        },
      }),
      res,
      defaultConfig,
    );

    expect(agentChat.call).toHaveBeenCalledWith("what events today?");
    expect(res._json.error).toBeUndefined();
    const task = res._json.result;
    expect(task.status.state).toBe("completed");
    expect(task.status.message.parts[0].text).toBe("Agent says hello");
    // Should have files-changed artifact
    expect(task.artifacts).toHaveLength(1);
    expect(task.artifacts[0].name).toBe("files-changed");
    expect(task.artifacts[0].parts[0].data.files).toEqual(["events.json"]);
  });

  it("handles empty text message gracefully", async () => {
    const res = mockRes();
    await handleJsonRpc(
      mockReq({
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "data", data: { key: "val" } }],
          },
        },
      }),
      res,
      defaultConfig,
    );

    const task = res._json.result;
    expect(task.status.state).toBe("completed");
    expect(task.status.message.parts[0].text).toBe(
      "No text content in message",
    );
  });
});
