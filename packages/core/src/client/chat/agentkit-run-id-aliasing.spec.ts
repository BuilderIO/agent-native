import {
  AgentKitClient,
  createAgentThreadState,
  reduceAgentEvent,
} from "@agent-native/agentkit/client";
import {
  parseAgentEvent,
  type AgentEvent,
} from "@agent-native/agentkit/protocol";
import { describe, expect, it, vi } from "vitest";

import { createAgentNativeAgentKitTransport } from "./agentkit-agent-native.js";
import { createAgentKitProtocolAdapter } from "./agentkit-protocol.js";
import type {
  AgentChatRuntime,
  AgentChatRuntimeEvent,
  AgentChatRuntimeTurn,
  AuthoritativeRunState,
} from "./runtime.js";

function userMessage(text: string, id = "user-1") {
  return {
    id,
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
    status: "complete" as const,
  };
}

function createContinuationRuntime(options: {
  initialEvents: () => AsyncIterable<AgentChatRuntimeEvent>;
  successorEvents: () => AsyncIterable<AgentChatRuntimeEvent>;
  readRunState: (input: {
    sessionId: string;
    runId?: string;
    turnId?: string;
  }) => Promise<AuthoritativeRunState>;
  onContinueTurn?: ReturnType<typeof vi.fn>;
  onSubscribe?: ReturnType<typeof vi.fn>;
}) {
  const continueTurn =
    options.onContinueTurn ??
    vi.fn(
      async (): Promise<AgentChatRuntimeTurn> => ({
        id: "turn-1",
        runId: "run-2",
        sessionId: "thread-1",
        events: options.successorEvents(),
      }),
    );
  const subscribe =
    options.onSubscribe ?? vi.fn(async () => options.successorEvents());

  const runtime: AgentChatRuntime = {
    id: "test-runtime",
    capabilities: {
      streaming: true,
      resumableRuns: true,
      sessions: { persistent: true, resumable: true, multiThread: true },
      messages: {
        attachments: false,
        references: false,
        edits: false,
        regenerate: false,
      },
      tools: { events: true, approvals: false },
      rich: {
        connectionRequests: true,
      },
    },
    async createSession(input) {
      const sessionId = input?.id ?? "thread-1";
      return {
        id: sessionId,
        runtimeId: "test-runtime",
        async startTurn() {
          return {
            id: "turn-1",
            runId: "run-1",
            sessionId,
            events: options.initialEvents(),
          };
        },
        continueTurn,
      };
    },
    readRunState: options.readRunState,
    subscribe,
  };

  return { runtime, continueTurn, subscribe };
}

describe("AgentKit aliased successor run IDs", () => {
  it("subscribes to an aliased successor runId without event.runId mismatch in AgentKitClient", async () => {
    const { runtime } = createContinuationRuntime({
      async *initialEvents() {
        yield {
          type: "tool-start",
          toolCallId: "call-1",
          toolName: "list-events",
          input: {},
          metadata: { seq: 1 },
        };
        yield {
          type: "tool-done",
          toolCallId: "call-1",
          toolName: "list-events",
          output: "ok",
          metadata: { seq: 2 },
        };
        yield {
          type: "auto_continue",
          reason: "run_timeout",
          metadata: { seq: 3 },
        };
      },
      async *successorEvents() {
        yield {
          type: "text",
          text: "Completed after continuation",
          metadata: { seq: 1 },
        };
        yield { type: "done", reason: "complete", metadata: { seq: 2 } };
      },
      async readRunState({ runId }) {
        if (runId === "run-1") {
          return {
            status: "truncated",
            runId: "run-1",
            turnId: "turn-1",
            dispatchMode: "foreground",
            terminalReason: "run_timeout",
          };
        }
        return {
          status: "completed",
          runId: "run-2",
          turnId: "turn-1",
          dispatchMode: "foreground",
          terminalReason: "done",
        };
      },
    });

    const transport = createAgentKitProtocolAdapter(runtime, {
      autoContinueLabel: "Continuing...",
    });
    const started = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Schedule meetings")],
    });
    expect(started.runId).toBe("run-1");

    const primaryEvents: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: "run-1",
      afterSequence: 0,
    })) {
      primaryEvents.push(event);
    }
    expect(primaryEvents.at(-1)?.type).toBe("run.completed");

    const aliasEvents: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: "run-2",
      afterSequence: 0,
    })) {
      const parsed = parseAgentEvent(event);
      expect(parsed.runId).toBe("run-2");
      aliasEvents.push(parsed);
    }
    expect(aliasEvents.length).toBeGreaterThan(0);
    expect(aliasEvents.at(-1)?.type).toBe("run.completed");

    const client = new AgentKitClient({
      transport: {
        ...transport,
        async getThreadSnapshot() {
          return {
            id: "thread-1",
            messages: [],
            runs: [
              {
                id: "run-2",
                threadId: "thread-1",
                status: "running",
                lastSequence: 0,
              },
            ],
            activeRunIds: ["run-2"],
          };
        },
      },
    });
    await client.loadThread("thread-1");
    await vi.waitFor(() => {
      expect(client.getThread("thread-1").runs["run-2"].status).toBe(
        "completed",
      );
    });
    await client.dispose();
    await transport.dispose();
  });

  it("replays terminal events under the aliased successor runId", async () => {
    const { runtime } = createContinuationRuntime({
      async *initialEvents() {
        yield {
          type: "auto_continue",
          reason: "run_timeout",
          metadata: { seq: 1 },
        };
      },
      async *successorEvents() {
        yield { type: "text", text: "Done", metadata: { seq: 1 } };
        yield { type: "done", reason: "complete", metadata: { seq: 2 } };
      },
      async readRunState({ runId }) {
        if (runId === "run-1") {
          return {
            status: "truncated",
            runId: "run-1",
            turnId: "turn-1",
            dispatchMode: "foreground",
            terminalReason: "run_timeout",
          };
        }
        return {
          status: "completed",
          runId: "run-2",
          turnId: "turn-1",
          dispatchMode: "foreground",
          terminalReason: "done",
        };
      },
    });

    const transport = createAgentKitProtocolAdapter(runtime);
    await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Replay me")],
    });
    for await (const _event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: "run-1",
      afterSequence: 0,
    })) {
      void _event;
    }

    const replayed = await transport.replayTerminalRun({
      threadId: "thread-1",
      runId: "run-2",
    });
    const state = replayed.reduce(
      reduceAgentEvent,
      createAgentThreadState("thread-1"),
    );
    expect(state.runs["run-2"]?.status).toBe("completed");
    await transport.dispose();
  });

  it("resolves aliased runtime runId in continueRun", async () => {
    let autoContinued = false;
    const continueTurn = vi
      .fn()
      .mockImplementationOnce(async () => {
        autoContinued = true;
        return {
          id: "turn-1",
          runId: "run-2",
          sessionId: "thread-1",
          events: (async function* () {
            yield {
              type: "error" as const,
              error: "Timed out",
              errorCode: "run_timeout",
              metadata: { seq: 1 },
            };
          })(),
        } satisfies AgentChatRuntimeTurn;
      })
      .mockResolvedValueOnce({
        id: "turn-1",
        runId: "run-3",
        sessionId: "thread-1",
        events: (async function* () {
          yield { type: "text", text: "Resumed", metadata: { seq: 1 } };
          yield { type: "done", reason: "complete", metadata: { seq: 2 } };
        })(),
      } satisfies AgentChatRuntimeTurn);

    const readRunState = vi.fn(
      async ({
        runId,
      }: {
        sessionId: string;
        runId?: string;
      }): Promise<AuthoritativeRunState> => {
        if (!autoContinued || runId === "run-1") {
          return {
            status: "truncated",
            runId: "run-1",
            turnId: "turn-1",
            dispatchMode: "foreground",
            terminalReason: "run_timeout",
            completedAt: Date.now(),
          };
        }
        return {
          status: "errored",
          runId: "run-2",
          turnId: "turn-1",
          dispatchMode: "foreground",
          terminalReason: "run_timeout",
          completedAt: Date.now(),
        };
      },
    );

    const startTurn = vi
      .fn()
      .mockResolvedValueOnce({
        id: "turn-1",
        runId: "run-1",
        sessionId: "thread-1",
        events: (async function* () {
          yield {
            type: "auto_continue" as const,
            reason: "run_timeout",
            metadata: { seq: 1 },
          };
        })(),
      } satisfies AgentChatRuntimeTurn)
      .mockResolvedValueOnce({
        id: "turn-1",
        runId: "run-3",
        sessionId: "thread-1",
        events: (async function* () {
          yield {
            type: "done" as const,
            reason: "complete",
            metadata: { seq: 1 },
          };
        })(),
      } satisfies AgentChatRuntimeTurn);

    const { runtime } = createContinuationRuntime({
      async *initialEvents() {
        return;
      },
      async *successorEvents() {
        return;
      },
      readRunState,
      onContinueTurn: continueTurn,
    });
    runtime.createSession = vi.fn(async (input) => ({
      id: input?.id ?? "thread-1",
      runtimeId: runtime.id,
      startTurn,
      continueTurn,
    }));

    const createSessionSpy = vi.spyOn(runtime, "createSession");
    const transport = createAgentKitProtocolAdapter(runtime);
    await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Start", "user-start-1")],
    });
    for await (const _event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: "run-1",
      afterSequence: 0,
    })) {
      void _event;
    }

    if (!transport.continueRun) {
      throw new Error("Expected continueRun to be defined");
    }
    const continued = await transport.continueRun({
      threadId: "thread-1",
      runId: "run-2",
    });
    expect(continued.runId).toBe("run-3");
    expect(createSessionSpy).toHaveBeenCalledTimes(1);
    expect(continueTurn).toHaveBeenCalledTimes(2);
    const replayed = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Start", "user-start-1")],
    });
    expect(replayed.runId).toBe("run-3");
    await transport.dispose();
  });

  it("resets runtimeSequence on connection continuation so reconnect reads successor from 0", async () => {
    const subscribe = vi.fn(
      async (input: {
        sessionId: string;
        runId: string;
        after?: number;
      }): Promise<AsyncIterable<AgentChatRuntimeEvent>> =>
        (async function* (): AsyncIterable<AgentChatRuntimeEvent> {
          if ((input.after ?? 0) <= 1) {
            yield {
              type: "text",
              text: "Connected and finished",
              metadata: { seq: 1 },
            };
          }
          if ((input.after ?? 0) <= 2) {
            yield { type: "done", reason: "complete", metadata: { seq: 2 } };
          }
        })(),
    );

    const { runtime } = createContinuationRuntime({
      async *initialEvents() {
        yield { type: "text", text: "Need connection", metadata: { seq: 5 } };
        yield {
          type: "connection-request",
          requestId: "conn-1",
          provider: "linear",
          reason: "connect",
          detail: "Connect Linear",
          metadata: { seq: 6 },
        };
      },
      async *successorEvents() {
        return;
      },
      async readRunState({ runId }) {
        if (runId === "run-2") {
          return {
            status: "running",
            runId: "run-2",
            turnId: "turn-1",
            dispatchMode: "foreground",
          };
        }
        return {
          status: "completed",
          runId: "run-1",
          turnId: "turn-1",
          dispatchMode: "foreground",
          terminalReason: "done",
        };
      },
      onSubscribe: subscribe,
    });

    const transport = createAgentKitProtocolAdapter(runtime);
    const started = await transport.startRun({
      threadId: "thread-1",
      messages: [userMessage("Check Linear")],
    });

    const initialEvents: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: started.runId,
      afterSequence: 0,
    })) {
      initialEvents.push(event);
    }
    expect(
      initialEvents.some((event) => event.type === "connection.requested"),
    ).toBe(true);

    if (!transport.resolveConnectionRequest) {
      throw new Error("Expected resolveConnectionRequest to be defined");
    }
    await transport.resolveConnectionRequest({
      threadId: "thread-1",
      runId: started.runId,
      requestId: "conn-1",
      response: { status: "connected" },
    });

    const resumedEvents: AgentEvent[] = [];
    for await (const event of transport.subscribeToRun({
      threadId: "thread-1",
      runId: started.runId,
      afterSequence: initialEvents.length,
    })) {
      resumedEvents.push(event);
    }

    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-2",
        after: 0,
      }),
    );
    expect(resumedEvents.at(-1)?.type).toBe("run.completed");
    await transport.dispose();
  });

  it("drops persisted alias run entries when threadSnapshotWithActiveRun canonicalizes to the local owner", async () => {
    const threadId = "thread-alias-snap";
    const apiUrl = "/_agent-native/agent-chat";
    let lastTurnId = "turn-1";
    let newestRunId = "run-1";
    let releaseSecondRun!: () => void;
    const secondRunDone = new Promise<void>((resolve) => {
      releaseSecondRun = resolve;
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url.pathname.endsWith("/_agent-native/agent-engine/status")) {
          return Response.json({ configured: true, chatEligible: true });
        }
        if (method === "POST" && url.pathname === apiUrl) {
          const body = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          lastTurnId =
            typeof body.turnId === "string" ? body.turnId : lastTurnId;
          if (body.autoContinueOfRunId === "run-1") {
            newestRunId = "run-2";
            const stream = new ReadableStream<Uint8Array>({
              async start(controller) {
                const enc = new TextEncoder();
                controller.enqueue(
                  enc.encode(
                    `data: ${JSON.stringify({ type: "text", text: "working", seq: 1 })}\n\n`,
                  ),
                );
                await secondRunDone;
                controller.enqueue(
                  enc.encode(
                    `data: ${JSON.stringify({ type: "done", reason: "complete", seq: 2 })}\n\n`,
                  ),
                );
                controller.close();
              },
            });
            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-2",
              },
            });
          }
          newestRunId = "run-1";
          return new Response(
            `data: ${JSON.stringify({ type: "auto_continue", reason: "run_timeout", seq: 1 })}\n\n`,
            {
              headers: {
                "Content-Type": "text/event-stream",
                "X-Run-Id": "run-1",
              },
            },
          );
        }
        if (url.pathname === `${apiUrl}/runs/latest`) {
          if (newestRunId === "run-1") {
            return Response.json({
              runId: "run-1",
              threadId,
              turnId: lastTurnId,
              status: "truncated",
              dispatchMode: "foreground",
              terminalReason: "run_timeout",
            });
          }
          return Response.json({
            runId: "run-2",
            threadId,
            turnId: lastTurnId,
            status: "running",
            dispatchMode: "foreground",
          });
        }
        if (url.pathname === `${apiUrl}/runs/active`) {
          return Response.json({
            active: true,
            status: "running",
            runId: "run-2",
            turnId: lastTurnId,
          });
        }
        if (/\/runs\/[^/]+\/events$/.test(url.pathname)) {
          return new Response("", {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        if (url.pathname === `${apiUrl}/threads/${threadId}`) {
          return Response.json({
            id: threadId,
            title: "Alias snapshot",
            threadData: JSON.stringify({
              messages: [],
              agentKit: {
                messages: [],
                runs: [
                  {
                    id: "run-1",
                    threadId,
                    status: "running",
                    lastSequence: 1,
                  },
                  {
                    id: "run-2",
                    threadId,
                    status: "running",
                    lastSequence: 1,
                  },
                ],
              },
            }),
          });
        }
        return Response.json({ ok: true });
      },
    );

    const transport = createAgentNativeAgentKitTransport({
      apiUrl,
      fetch: fetchMock as typeof fetch,
    });

    const started = await transport.startRun({
      threadId,
      messages: [userMessage("Start work")],
    });
    expect(started.runId).toBe("run-1");

    const pump = (async () => {
      for await (const _event of transport.subscribeToRun({
        threadId,
        runId: "run-1",
        afterSequence: 0,
      })) {
        void _event;
      }
    })();

    await vi.waitFor(async () => {
      const aliasOwner = await transport.getRun?.({ threadId, runId: "run-2" });
      expect(aliasOwner?.id).toBe("run-1");
    });

    const snapshot = await transport.getThreadSnapshot?.({ threadId });
    const run2Entry = snapshot?.runs?.find((entry) => entry.id === "run-2");
    expect(run2Entry).toBeUndefined();
    expect(snapshot?.activeRunIds).toEqual(["run-1"]);

    releaseSecondRun();
    await pump;
    await transport.dispose();
  });
});
