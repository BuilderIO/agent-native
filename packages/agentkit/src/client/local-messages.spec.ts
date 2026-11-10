import { describe, expect, it, vi } from "vitest";

import type {
  AgentEvent,
  AgentMessage,
  AgentThreadSnapshot,
  AgentTransport,
} from "../protocol/index.js";
import { AgentKitClient } from "./client.js";

function createTransport(): AgentTransport {
  return {
    async createThread() {
      throw new Error("unused");
    },
    async getThreadSnapshot() {
      throw new Error("unused");
    },
    async startRun() {
      throw new Error("unused");
    },
    async *subscribeToRun() {},
    async cancelRun() {},
    async assertAiSetupReady() {},
  } as unknown as AgentTransport;
}

const userTurn = (text: string, status: AgentMessage["status"]) =>
  ({
    id: "voice-user-1",
    role: "user",
    parts: [{ type: "text", text }],
    status,
  }) satisfies AgentMessage;

describe("AgentKitClient.upsertLocalMessages", () => {
  it("appends new messages and updates known ids in place", () => {
    const client = new AgentKitClient({ transport: createTransport() });
    const listener = vi.fn();
    client.subscribe(listener);

    client.upsertLocalMessages("thread-1", [userTurn("Make the", "streaming")]);
    client.upsertLocalMessages("thread-1", [
      {
        id: "voice-assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Sure" }],
        status: "streaming",
      },
    ]);
    client.upsertLocalMessages("thread-1", [
      userTurn("Make the header blue", "complete"),
    ]);

    const messages = client.getThread("thread-1").messages;
    expect(messages.map((message) => message.id)).toEqual([
      "voice-user-1",
      "voice-assistant-1",
    ]);
    expect(messages[0]).toMatchObject({
      status: "complete",
      parts: [{ type: "text", text: "Make the header blue" }],
    });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("rejects a malformed message instead of storing it", () => {
    const client = new AgentKitClient({ transport: createTransport() });

    expect(() =>
      client.upsertLocalMessages("thread-1", [
        { id: "bad", role: "narrator", parts: [] } as unknown as AgentMessage,
      ]),
    ).toThrow(/role/);
    expect(client.getThread("thread-1").messages).toEqual([]);
  });

  it("saves local messages through the transport snapshot", async () => {
    const transport = createTransport();
    let saved: AgentThreadSnapshot | undefined;
    transport.persistThreadSnapshot = vi.fn(async ({ snapshot }) => {
      saved = snapshot;
    });
    const client = new AgentKitClient({ transport });

    client.upsertLocalMessages("thread-1", [
      userTurn("Make the header blue", "complete"),
    ]);
    await expect(
      client.persistThreadSnapshotWithResult("thread-1"),
    ).resolves.toBe(true);

    expect(saved?.messages).toEqual([
      userTurn("Make the header blue", "complete"),
    ]);
  });
});

describe("AgentKitClient.appendLocalEvents", () => {
  const at = "2026-10-24T00:00:00.000Z";
  const toolEvents = (threadId: string): AgentEvent[] => [
    {
      id: "voice:call-1:1",
      threadId,
      runId: "voice:call-1",
      sequence: 1,
      occurredAt: at,
      type: "tool.started",
      toolCall: { id: "call-1", name: "web-search", status: "running" },
    },
    {
      id: "voice:call-1:2",
      threadId,
      runId: "voice:call-1",
      sequence: 2,
      occurredAt: at,
      type: "run.completed",
    },
  ];

  it("folds a local run into the thread and skips repeated sequences", () => {
    const client = new AgentKitClient({ transport: createTransport() });
    const [started, completed] = toolEvents("thread-1");

    client.appendLocalEvents("thread-1", [started!]);
    client.appendLocalEvents("thread-1", [started!, completed!]);

    const thread = client.getThread("thread-1");
    expect(thread.events.map((event) => event.id)).toEqual([
      "voice:call-1:1",
      "voice:call-1:2",
    ]);
    expect(thread.runs["voice:call-1"]?.status).toBe("completed");
    expect(thread.tools["call-1"]?.name).toBe("web-search");
    expect(thread.activeRunIds).toEqual([]);
  });

  it("rejects a sequence gap or another thread's event without applying any", () => {
    const client = new AgentKitClient({ transport: createTransport() });
    const [started, completed] = toolEvents("thread-1");

    expect(() =>
      client.appendLocalEvents("thread-1", [
        started!,
        { ...completed!, sequence: 3 },
      ]),
    ).toThrow(/contiguous/);
    expect(() =>
      client.appendLocalEvents("thread-1", toolEvents("thread-2")),
    ).toThrow(/threadId/);
    expect(client.getThread("thread-1").events).toEqual([]);
  });
});
