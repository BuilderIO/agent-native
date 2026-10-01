import { AgentKitClient } from "@agent-native/agentkit/client";
import { describe, expect, it, vi } from "vitest";

import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";
import type { AgentChatRuntime } from "./runtime.js";

const runStateMocks = vi.hoisted(() => ({
  dispatchAgentChatRunning: vi.fn(),
}));

vi.mock("../use-agent-chat-running-threads.js", () => runStateMocks);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AgentKit queued steering", () => {
  it("cancels a server run discovered after reload", async () => {
    const cancel = vi.fn(async () => ({ status: "cancelled" as const }));
    const runtime: AgentChatRuntime = {
      id: "test:restored-run",
      kind: "agent-native",
      label: "Restored run test runtime",
      capabilities: {
        messages: { streaming: true },
        tools: { events: true },
        sessions: { create: true },
        cancellation: { explicitCancel: true },
      },
      async createSession(input) {
        return {
          id: input?.id ?? "thread-restored",
          runtimeId: "test:restored-run",
          startTurn: async () => {
            throw new Error("No new turn expected");
          },
        };
      },
      cancel,
    };
    const transport = createAgentNativeAgentKitTransport({ runtime });

    await expect(
      transport.cancelRun({
        threadId: "thread-restored",
        runId: "run-restored-from-server",
      }),
    ).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledWith({
      sessionId: "thread-restored",
      runId: "run-restored-from-server",
      reason: "protocol-cancel",
    });
    await transport.dispose();
  });

  it("cancels an active run and promotes a steered item through the real transport", async () => {
    const threadId = "thread-queue-steer";
    const apiUrl = "/_agent-native/agent-chat";
    const queue: Array<Record<string, unknown>> = [];
    const activeReads: boolean[] = [];
    const prompts: string[] = [];
    const turns: unknown[] = [];
    const cancellations: string[] = [];
    let active = false;
    let runNumber = 0;
    let releaseFirstRun: (() => void) | undefined;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url.startsWith(`${apiUrl}/runs/active?`)) {
          activeReads.push(active);
          return json({
            active,
            ...(active ? { status: "running", runId: "run-1" } : {}),
          });
        }
        if (url.endsWith(`/threads/${threadId}/queued`) && method === "POST") {
          const { mutation } = JSON.parse(String(init?.body));
          if (mutation.type === "append") {
            queue.push(mutation.message);
            return json({ queuedMessages: queue, message: mutation.message });
          }
          if (mutation.type === "claim") {
            const index = queue.findIndex(
              (item) => item.id === mutation.messageId,
            );
            const [removedMessage] = queue.splice(index, 1);
            return json({ queuedMessages: queue, removedMessage, index });
          }
          if (mutation.type === "restore") {
            queue.splice(mutation.index, 0, mutation.message);
            return json({ queuedMessages: queue });
          }
          return json({ queuedMessages: queue });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            threadData: JSON.stringify({ messages: [], queuedMessages: queue }),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          return json({});
        }
        return json({ error: `Unexpected request: ${method} ${url}` }, 404);
      },
    );
    const runtime: AgentChatRuntime = {
      id: "test:queue-steer",
      kind: "external-agent",
      label: "Queue steer test runtime",
      capabilities: {
        messages: { streaming: true, history: true, structuredContent: true },
        tools: { events: true },
        sessions: { create: true, persistent: true },
        cancellation: { explicitCancel: true, interrupt: true },
      },
      async createSession(input) {
        const sessionId = input?.id ?? threadId;
        return {
          id: sessionId,
          threadId,
          runtimeId: "test:queue-steer",
          async startTurn(input) {
            const currentRun = ++runNumber;
            turns.push(input);
            prompts.push(input.prompt ?? "");
            if (currentRun === 1) active = true;
            let release!: () => void;
            const stopped = new Promise<void>((resolve) => {
              release = resolve;
            });
            if (currentRun === 1) releaseFirstRun = release;
            return {
              id: `turn-${currentRun}`,
              runId: `run-${currentRun}`,
              sessionId,
              events: (async function* () {
                if (currentRun === 1) await stopped;
                if (currentRun === 2) active = false;
                yield { type: "done", reason: "complete" } as const;
              })(),
              cancel: async () => {
                cancellations.push(`run-${currentRun}`);
                active = false;
                release();
                return { status: "cancelled" } as const;
              },
            };
          },
        };
      },
      async cancel({ runId }) {
        cancellations.push(runId ?? "");
        active = false;
        releaseFirstRun?.();
        return { status: "cancelled" };
      },
    };
    const transport = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
      runtime,
      adapter: { createId: () => "queued-steer" },
    });
    const client = new AgentKitClient({ transport });

    try {
      await client.loadThread(threadId);
      const activeRun = await client.sendMessage({
        threadId,
        text: "Keep working until interrupted",
      });
      const options = {
        agentId: "agent-queued",
        model: "test-model",
        reasoningEffort: "high" as const,
        toolChoice: "required" as const,
        temperature: 0.25,
        locale: "en-US",
        mode: "act",
        parallelToolCalls: false,
        metadata: { queueOption: "kept" },
      };
      const queued = await client.queueMessage({
        threadId,
        text: "Only run this after I steer it",
        options,
      });
      expect(queued.options).toEqual(options);

      await expect(
        transport.steerQueuedMessage?.({ threadId, messageId: queued.id }),
      ).rejects.toMatchObject({ code: "run_slot_busy" });
      expect(activeReads.length).toBeGreaterThanOrEqual(4);
      expect(activeReads.every(Boolean)).toBe(true);
      expect(queue).toHaveLength(1);
      expect(client.getThread(threadId).activeRunIds).toEqual(["run-1"]);

      const steeredRun = await transport.steerQueuedMessage?.({
        threadId,
        messageId: queued.id,
        interruptActiveRun: true,
      });

      expect(cancellations).toEqual(["run-1"]);
      expect(active).toBe(false);
      expect(steeredRun?.runId).toBe("run-2");
      expect(prompts).toEqual([
        "Keep working until interrupted",
        "Only run this after I steer it",
      ]);
      expect(turns[1]).toMatchObject({
        model: "test-model",
        reasoningEffort: "high",
        temperature: 0.25,
        providerOptions: {
          toolChoice: "required",
          parallelToolCalls: false,
        },
        metadata: {
          agentId: "agent-queued",
          locale: "en-US",
          mode: "act",
          queueOption: "kept",
        },
      });
      expect(queue).toHaveLength(0);
      expect(activeReads.slice(-2)).toEqual([false, false]);
      releaseFirstRun?.();
      await activeRun.completed.catch(() => undefined);
    } finally {
      await client.shutdown();
      await transport.dispose();
    }
  });

  it("restores a claimed item when startRun loses a run-slot race", async () => {
    const threadId = "thread-claim-race";
    const apiUrl = "/_agent-native/agent-chat";
    const queued = {
      id: "queued-claim-race",
      threadId,
      text: "Do not lose me",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const queue = [queued];
    const mutations: string[] = [];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url.startsWith(`${apiUrl}/runs/active?`)) {
          return json({ active: false });
        }
        if (url.endsWith(`/threads/${threadId}/queued`) && method === "POST") {
          const { mutation } = JSON.parse(String(init?.body));
          mutations.push(mutation.type);
          if (mutation.type === "claim") {
            const index = queue.findIndex(
              (item) => item.id === mutation.messageId,
            );
            const [removedMessage] = queue.splice(index, 1);
            return json({ queuedMessages: queue, removedMessage, index });
          }
          if (mutation.type === "restore") {
            queue.splice(mutation.index, 0, mutation.message);
            return json({ queuedMessages: queue });
          }
          return json({ queuedMessages: queue });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            createdAt: queued.createdAt,
            updatedAt: queued.createdAt,
            threadData: JSON.stringify({ messages: [], queuedMessages: queue }),
          });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "PUT") {
          return json({});
        }
        return json({ error: `Unexpected request: ${method} ${url}` }, 404);
      },
    );
    let starts = 0;
    const runtime: AgentChatRuntime = {
      id: "test:queue-claim-race",
      kind: "external-agent",
      label: "Queue claim race test runtime",
      capabilities: {
        messages: { streaming: true, history: true },
        tools: { events: true },
        sessions: { create: true, persistent: true },
      },
      async createSession(input) {
        return {
          id: input?.id ?? threadId,
          runtimeId: "test:queue-claim-race",
          async startTurn() {
            starts += 1;
            throw Object.assign(new Error("Run already in progress"), {
              code: "run_slot_busy",
              activeRunId: "run-won-elsewhere",
            });
          },
        };
      },
    };
    const transport = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
      runtime,
    });

    try {
      await expect(
        transport.steerQueuedMessage?.({ threadId, messageId: queued.id }),
      ).rejects.toMatchObject({
        code: "run_slot_busy",
        activeRunId: "run-won-elsewhere",
      });
      expect(starts).toBe(1);
      expect(mutations).toEqual(["claim", "restore"]);
      expect(queue).toEqual([queued]);
    } finally {
      await transport.dispose();
    }
  });

  it("treats a lost claim as already promoted by another tab", async () => {
    const threadId = "thread-other-tab-claim";
    const apiUrl = "/_agent-native/agent-chat";
    const queued = {
      id: "queued-other-tab-claim",
      threadId,
      text: "Already claimed",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    let removeBeforeClaim = false;
    const queue = [queued];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url.startsWith(`${apiUrl}/runs/active?`)) {
          removeBeforeClaim = true;
          queue.splice(0, 1);
          return json({ active: false });
        }
        if (url.endsWith(`/threads/${threadId}/queued`) && method === "POST") {
          const { mutation } = JSON.parse(String(init?.body));
          if (mutation.type === "claim" && removeBeforeClaim) {
            return json({ error: `Unknown queued message: ${queued.id}` }, 409);
          }
          return json({ queuedMessages: queue });
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            createdAt: queued.createdAt,
            updatedAt: queued.createdAt,
            threadData: JSON.stringify({ messages: [], queuedMessages: queue }),
          });
        }
        return json({ error: `Unexpected request: ${method} ${url}` }, 404);
      },
    );
    const runtime: AgentChatRuntime = {
      id: "test:queue-other-tab-claim",
      kind: "external-agent",
      label: "Queue other-tab test runtime",
      capabilities: {
        messages: { streaming: true },
        tools: { events: true },
        sessions: { create: true },
      },
      async createSession(input) {
        return {
          id: input?.id ?? threadId,
          runtimeId: "test:queue-other-tab-claim",
          async startTurn() {
            throw new Error("Another tab already started this turn");
          },
        };
      },
    };
    const transport = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
      runtime,
    });
    const onError = vi.fn();
    const client = new AgentKitClient({ transport, onError });

    try {
      await client.loadThread(threadId);
      await expect(
        client.steerQueuedMessage(threadId, queued.id),
      ).resolves.toBeUndefined();
      expect(client.getThread(threadId).queuedMessages).toEqual([]);
      expect(client.getThread(threadId).messages).toContainEqual(
        expect.objectContaining({ id: queued.id, role: "user" }),
      );
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await client.shutdown();
      await transport.dispose();
    }
  });
});
