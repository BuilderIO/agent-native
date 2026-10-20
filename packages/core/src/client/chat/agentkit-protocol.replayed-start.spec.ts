import type { AgentMessage } from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

import { createAgentKitProtocolAdapter } from "./agentkit-protocol.js";
import type { AgentChatRuntime } from "./runtime.js";

function userMessage(text: string): AgentMessage {
  return {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text }],
  };
}

async function* neverEnds(): AsyncGenerator<never> {
  await new Promise<void>(() => {});
}

function runtimeWith(startTurn: () => Promise<unknown>): AgentChatRuntime {
  return {
    id: "runtime-test",
    kind: "external-agent",
    label: "Test runtime",
    capabilities: {
      messages: { streaming: true, history: true, attachments: true },
    },
    async createSession() {
      return { id: "thread-1", runtimeId: "runtime-test", startTurn };
    },
  } as unknown as AgentChatRuntime;
}

// A replayed submission answers with the id of the run it already started, so
// a start for a live run attaches to that run instead of indexing it twice.
describe("createAgentKitProtocolAdapter replayed start", () => {
  it("attaches to the live run when a start returns its runtime run id", async () => {
    const startTurn = vi.fn(async () => ({
      id: "turn-1",
      runId: "core-run-1",
      sessionId: "thread-1",
      events: neverEnds(),
    }));
    const transport = createAgentKitProtocolAdapter(runtimeWith(startTurn));

    try {
      const first = await transport.startRun({
        threadId: "thread-1",
        messages: [userMessage("Publish this")],
      });
      const replay = await transport.startRun({
        threadId: "thread-1",
        messages: [userMessage("Publish this")],
      });

      expect(startTurn).toHaveBeenCalledTimes(2);
      expect(replay.runId).toBe(first.runId);
    } finally {
      await transport.dispose();
    }
  });

  it("rejects a replayed start that resolves after the adapter began disposing", async () => {
    const replayed = Promise.withResolvers<unknown>();
    const startTurn = vi
      .fn()
      .mockResolvedValueOnce({
        id: "turn-1",
        runId: "core-run-1",
        sessionId: "thread-1",
        events: neverEnds(),
      })
      .mockImplementationOnce(() => replayed.promise);
    const transport = createAgentKitProtocolAdapter(runtimeWith(startTurn));

    await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Publish this")],
    });
    const replay = transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Publish this")],
    });
    await vi.waitFor(() => expect(startTurn).toHaveBeenCalledTimes(2));

    const disposing = transport.dispose();
    replayed.resolve({
      id: "turn-2",
      runId: "core-run-1",
      sessionId: "thread-1",
      events: neverEnds(),
    });

    await expect(replay).rejects.toThrow("disposed during turn creation");
    await disposing;
  });
});
