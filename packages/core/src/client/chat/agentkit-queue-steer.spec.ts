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
  it.each([{ promoted: false }, { promoted: true }])(
    "reconciles an unknown claim against durable history before assuming promotion (%s)",
    async ({ promoted }) => {
      const threadId = "thread-claim-race";
      const messageId = "queued-claim-race";
      const queued = {
        id: messageId,
        threadId,
        text: "Run once",
        createdAt: "2026-10-01T00:00:00.000Z",
      };
      let queuedMessages: Array<Record<string, unknown>> = [queued];
      let messages: Array<Record<string, unknown>> = [];
      let initialSnapshotRead = false;
      let startRunRequests = 0;
      const apiUrl = "/_agent-native/agent-chat";
      const fetcher = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const url = String(input);
          const method = String(init?.method ?? "GET").toUpperCase();
          if (url.startsWith(`${apiUrl}/runs/active?`)) {
            return json({ active: false, status: "completed" });
          }
          if (
            url.endsWith(`/threads/${threadId}/queued`) &&
            method === "POST"
          ) {
            return json({ error: `Unknown queued message: ${messageId}` }, 409);
          }
          if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
            const response = json({
              id: threadId,
              createdAt: queued.createdAt,
              updatedAt: queued.createdAt,
              threadData: JSON.stringify({ messages, queuedMessages }),
            });
            if (!initialSnapshotRead) {
              initialSnapshotRead = true;
              queuedMessages = [];
              if (promoted) {
                messages = [
                  {
                    id: "server-user-run-promoted",
                    role: "user",
                    content: queued.text,
                    metadata: {
                      custom: {
                        agentNativeQueuedMessageId: messageId,
                        submittedRunId: "run-promoted",
                      },
                    },
                  },
                ];
              }
            }
            return response;
          }
          if (url === apiUrl) startRunRequests += 1;
          return json({ error: `Unexpected request: ${method} ${url}` }, 404);
        },
      );
      const transport = createAgentNativeAgentKitTransport({
        apiUrl,
        fetch: fetcher as typeof fetch,
      });

      const steering = transport.steerQueuedMessage?.({ threadId, messageId });
      if (promoted)
        await expect(steering).resolves.toMatchObject({
          runId: "run-promoted",
          alreadySubmitted: true,
        });
      else
        await expect(steering).resolves.toMatchObject({
          alreadyRemoved: true,
        });

      expect(startRunRequests).toBe(0);
      await transport.dispose();
    },
  );

  it("reconciles a queue item already promoted before the first snapshot", async () => {
    const threadId = "thread-first-snapshot-race";
    const messageId = "queued-first-snapshot-race";
    const apiUrl = "/_agent-native/agent-chat";
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/threads/${threadId}`)) {
        return json({
          id: threadId,
          createdAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-01T00:00:00.000Z",
          threadData: JSON.stringify({
            messages: [
              {
                id: "server-user-run-promoted",
                role: "user",
                content: "Run once",
                metadata: {
                  custom: {
                    agentNativeQueuedMessageId: messageId,
                    submittedRunId: "run-promoted",
                  },
                },
              },
            ],
            queuedMessages: [],
          }),
        });
      }
      return json({ error: `Unexpected request: ${url}` }, 404);
    });
    const transport = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
    });

    await expect(
      transport.steerQueuedMessage?.({ threadId, messageId }),
    ).resolves.toMatchObject({
      runId: "run-promoted",
      alreadySubmitted: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    await transport.dispose();
  });

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
    const queue: Array<
      Record<string, unknown> & {
        promotionClaim?: { id: string; expiresAt: number };
      }
    > = [];
    const activeReads: boolean[] = [];
    const prompts: string[] = [];
    const turns: unknown[] = [];
    const cancellations: string[] = [];
    const mutations: string[] = [];
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
          mutations.push(mutation.type);
          if (mutation.type === "append") {
            queue.push(mutation.message);
            return json({ queuedMessages: queue, message: mutation.message });
          }
          if (mutation.type === "claim") {
            const index = queue.findIndex(
              (item) => item.id === mutation.messageId,
            );
            if (index < 0) {
              return json(
                { error: `Unknown queued message: ${mutation.messageId}` },
                409,
              );
            }
            const claimedMessage = {
              ...queue[index],
              promotionClaim: {
                id: mutation.claimId,
                expiresAt: Date.now() + 60_000,
              },
            };
            queue[index] = claimedMessage;
            return json({ queuedMessages: queue, claimedMessage });
          }
          if (mutation.type === "release") {
            const index = queue.findIndex(
              (item) => item.id === mutation.messageId,
            );
            if (queue[index]?.promotionClaim?.id === mutation.claimId) {
              const { promotionClaim: _claim, ...released } = queue[index]!;
              queue[index] = released;
            }
            return json({ queuedMessages: queue, released: true });
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
            if (active) {
              throw Object.assign(new Error("Run already in progress"), {
                code: "run_slot_busy",
                activeRunId: "run-1",
                retryable: true,
              });
            }
            const currentRun = ++runNumber;
            if (input.queuePromotion) {
              const queuedIndex = queue.findIndex(
                (item) => item.id === input.queuePromotion?.messageId,
              );
              expect(queuedIndex).toBeGreaterThanOrEqual(0);
              expect(queue[queuedIndex]?.promotionClaim?.id).toBe(
                input.queuePromotion.claimId,
              );
              queue.splice(queuedIndex, 1);
            }
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
                setTimeout(() => {
                  active = false;
                }, 700);
                release();
                return { status: "cancelled" } as const;
              },
            };
          },
        };
      },
      async cancel({ runId }) {
        cancellations.push(runId ?? "");
        setTimeout(() => {
          active = false;
        }, 700);
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
      expect(activeReads).toEqual([]);
      expect(queue).toHaveLength(1);
      expect(queue[0]).not.toHaveProperty("promotionClaim");
      expect(mutations).toEqual(["append", "claim", "release"]);
      expect(client.getThread(threadId).activeRunIds).toEqual(["run-1"]);

      const steeredRun = await client.steerQueuedMessage(
        threadId,
        queued.id,
        undefined,
        { interruptActiveRun: true },
      );

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
      expect(runNumber).toBe(2);
      expect(activeReads).toContain(true);
      expect(activeReads.slice(-2)).toEqual([false, false]);
      expect(turns[1]).toMatchObject({
        queuePromotion: {
          messageId: queued.id,
          claimId: expect.any(String),
          turnId: `queue-${queued.id}`,
        },
      });
      releaseFirstRun?.();
      await activeRun.completed.catch(() => undefined);
    } finally {
      await client.shutdown();
      await transport.dispose();
    }
  });

  it("releases its lease when startRun loses a run-slot race", async () => {
    const threadId = "thread-claim-race";
    const apiUrl = "/_agent-native/agent-chat";
    const queued = {
      id: "queued-claim-race",
      threadId,
      text: "Do not lose me",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const queue: Array<
      typeof queued & {
        promotionClaim?: { id: string; expiresAt: number };
      }
    > = [queued];
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
            const claimedMessage = {
              ...queue[index],
              promotionClaim: {
                id: mutation.claimId,
                expiresAt: Date.now() + 60_000,
              },
            };
            queue[index] = claimedMessage;
            return json({ queuedMessages: queue, claimedMessage });
          }
          if (mutation.type === "release") {
            const index = queue.findIndex(
              (item) => item.id === mutation.messageId,
            );
            if (queue[index]?.promotionClaim?.id === mutation.claimId) {
              const { promotionClaim: _claim, ...released } = queue[index]!;
              queue[index] = released;
            }
            return json({ queuedMessages: queue, released: true });
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
      expect(mutations).toEqual(["claim", "release"]);
      expect(queue).toEqual([queued]);
    } finally {
      await transport.dispose();
    }
  });

  it("parks an early send after a real AgentKit transport returns a typed 409", async () => {
    const threadId = "thread-submit-before-hydration";
    const apiUrl = "/_agent-native/agent-chat";
    const queue: Array<
      Record<string, unknown> & {
        promotionClaim?: { id: string; expiresAt: number };
      }
    > = [];
    let starts = 0;
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url === apiUrl && method === "POST") {
          starts += 1;
          return json(
            {
              data: {
                code: "run_slot_busy",
                activeRunId: "run-active-after-reload",
                retryable: true,
              },
            },
            409,
          );
        }
        if (url.endsWith(`/threads/${threadId}/queued`) && method === "POST") {
          const { mutation } = JSON.parse(String(init?.body));
          if (mutation.type === "append") {
            queue.push(mutation.message);
            return json({ queuedMessages: queue, message: mutation.message });
          }
          if (mutation.type === "claim") {
            const index = queue.findIndex(
              (message) => message.id === mutation.messageId,
            );
            if (index < 0) {
              return json(
                { error: `Unknown queued message: ${mutation.messageId}` },
                409,
              );
            }
            const claimedMessage = {
              ...queue[index],
              promotionClaim: {
                id: mutation.claimId,
                expiresAt: Date.now() + 60_000,
              },
            };
            queue[index] = claimedMessage;
            return json({ queuedMessages: queue, claimedMessage });
          }
          if (mutation.type === "release") {
            const index = queue.findIndex(
              (message) => message.id === mutation.messageId,
            );
            if (queue[index]?.promotionClaim?.id === mutation.claimId) {
              const { promotionClaim: _claim, ...released } = queue[index]!;
              queue[index] = released;
            }
            return json({ queuedMessages: queue, released: true });
          }
        }
        if (url.endsWith(`/threads/${threadId}`) && method === "GET") {
          return json({
            id: threadId,
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            threadData: JSON.stringify({ messages: [], queuedMessages: queue }),
          });
        }
        if (url.startsWith(`${apiUrl}/runs/active?`)) {
          return json({
            active: true,
            status: "running",
            runId: "run-active-after-reload",
          });
        }
        return json({ error: `Unexpected request: ${method} ${url}` }, 404);
      },
    );
    const transport = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetcher as typeof fetch,
    });
    transport.subscribeToRun = async function* ({ signal }) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    };
    const onError = vi.fn();
    const client = new AgentKitClient({ transport, onError });

    try {
      const handle = await client.sendMessage({
        threadId,
        text: "Submit before active-run hydration completes",
      });

      expect(handle.runId).toBe("run-active-after-reload");
      expect(starts).toBeGreaterThanOrEqual(1);
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        text: "Submit before active-run hydration completes",
        id: expect.any(String),
      });
      expect(client.getThread(threadId)).toMatchObject({
        queuedMessages: [
          expect.objectContaining({
            text: "Submit before active-run hydration completes",
          }),
        ],
        messages: [],
      });
      expect(
        client
          .getThread(threadId)
          .messages.some((message) => message.status === "error"),
      ).toBe(false);
      expect(onError).not.toHaveBeenCalled();

      await vi.waitFor(() => expect(starts).toBeGreaterThanOrEqual(2));
      expect(queue[0]).not.toHaveProperty("promotionClaim");
    } finally {
      await client.shutdown();
      await transport.dispose();
    }
  });

  it("keeps an unproven claim queued without adding transcript history", async () => {
    const threadId = "thread-other-tab-claim";
    const apiUrl = "/_agent-native/agent-chat";
    const queued = {
      id: "queued-other-tab-claim",
      threadId,
      text: "Already claimed",
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const queue = [queued];
    const fetcher = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url.endsWith(`/threads/${threadId}/queued`) && method === "POST") {
          const { mutation } = JSON.parse(String(init?.body));
          if (mutation.type === "claim") {
            return json(
              {
                error: "Run already in progress for this thread",
                code: "run_slot_busy",
                retryable: true,
              },
              409,
            );
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
      ).rejects.toMatchObject({ code: "run_slot_busy" });
      expect(client.getThread(threadId).queuedMessages).toEqual([queued]);
      expect(client.getThread(threadId).messages).toEqual([]);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await client.shutdown();
      await transport.dispose();
    }
  });
});
