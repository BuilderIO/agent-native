import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AgentChatRuntime as AgentChatRuntimeFromClientBarrel } from "../index.js";
import type { AgentChatRuntime as AgentChatRuntimeFromChatBarrel } from "./index.js";
import {
  createAgentChatRuntimeAdapter,
  createAgentNativeChatRuntime,
  createHttpAgentChatRuntime,
  type AgentChatRuntime,
  type AgentChatRuntimeEvent,
  type AgentChatRuntimeKnownEvent,
  type AgentChatRuntimeMessage,
  type AgentChatRuntimeToolCall,
  type AgentChatRuntimeTurn,
} from "./runtime.js";

async function* streamRuntimeEvents(): AsyncIterable<AgentChatRuntimeEvent> {
  yield {
    type: "message-start",
    message: { id: "message-1", role: "assistant", content: [] },
  };
  yield {
    type: "message-delta",
    messageId: "message-1",
    delta: { type: "text", text: "Hello" },
  };
  yield {
    type: "tool-start",
    toolCall: { id: "tool-1", name: "search", input: { q: "docs" } },
  };
  yield {
    type: "tool-done",
    toolCallId: "tool-1",
    toolName: "search",
    status: "completed",
    resultText: "Found docs",
  };
  yield { type: "done", reason: "complete" };
}

function sseResponse(events: unknown[], runId = "run-runtime"): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const body = events
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join("");
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Run-Id": runId,
      },
    },
  );
}

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("AgentChatRuntime types", () => {
  it("describe an external runtime with sessions, streaming, tools, and cancellation", () => {
    const runtime: AgentChatRuntime = {
      id: "external:mastra",
      kind: "external-agent",
      label: "Mastra",
      capabilities: {
        messages: {
          streaming: true,
          history: true,
          structuredContent: true,
          attachments: true,
        },
        tools: {
          events: true,
          hostTools: true,
          inputStreaming: true,
          resultStreaming: true,
        },
        sessions: {
          create: true,
          restore: true,
          persistent: true,
        },
        cancellation: {
          abortSignal: true,
          explicitCancel: true,
          interrupt: true,
        },
      },
      async createSession(input) {
        const sessionId = input?.id ?? "session-1";
        return {
          id: sessionId,
          runtimeId: "external:mastra",
          startTurn(): AgentChatRuntimeTurn {
            return {
              id: "turn-1",
              sessionId,
              events: streamRuntimeEvents(),
              cancel: async () => ({ status: "cancelled" }),
            };
          },
          cancelTurn: async () => ({ status: "cancelled" }),
        };
      },
    };

    expectTypeOf(runtime).toMatchTypeOf<AgentChatRuntime>();
    expectTypeOf(runtime.createSession).parameters.toEqualTypeOf<
      [input?: Parameters<AgentChatRuntime["createSession"]>[0]]
    >();
  });

  it("keeps normalized event and message shapes discriminated", () => {
    expectTypeOf<
      Extract<AgentChatRuntimeEvent, { type: "tool-start" }>["toolCall"]
    >().toEqualTypeOf<AgentChatRuntimeToolCall>();
    expectTypeOf<
      Extract<AgentChatRuntimeEvent, { type: "message-done" }>["message"]
    >().toEqualTypeOf<AgentChatRuntimeMessage>();
    expectTypeOf<AgentChatRuntimeKnownEvent>().toMatchTypeOf<AgentChatRuntimeEvent>();
  });

  it("exports the runtime contract from client barrels", () => {
    expectTypeOf<AgentChatRuntimeFromChatBarrel>().toEqualTypeOf<AgentChatRuntime>();
    expectTypeOf<AgentChatRuntimeFromClientBarrel>().toEqualTypeOf<AgentChatRuntime>();
  });
});

describe("createHttpAgentChatRuntime", () => {
  it("posts turns, streams runtime events, exposes run id, and cancels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "message-start",
            message: { id: "m1", role: "assistant", content: [] },
          },
          {
            type: "message-delta",
            messageId: "m1",
            delta: { type: "text", text: "Hello" },
          },
          {
            type: "message-done",
            message: {
              id: "m1",
              role: "assistant",
              content: [{ type: "text", text: "Hello" }],
            },
          },
          { type: "done", reason: "complete" },
        ]),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));

    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      cancelEndpoint: ({ runId }) => `/agent/runs/${runId}/cancel`,
      fetch: fetchMock as typeof fetch,
      headers: { Authorization: "Bearer test" },
    });

    const session = await runtime.createSession({
      id: "thread-1",
      threadId: "thread-1",
    });
    const turn = await session.startTurn({ prompt: "Say hello" });
    const events = await drain(turn.events);

    expect(turn.runId).toBe("run-runtime");
    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "message-done",
      "done",
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("/agent/chat");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      sessionId: "thread-1",
      threadId: "thread-1",
      prompt: "Say hello",
    });

    await turn.cancel?.({ reason: "user" });
    expect(fetchMock.mock.calls[1][0]).toBe("/agent/runs/run-runtime/cancel");
  });

  it("accepts JSON response text as a simple assistant turn", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: "Done" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "finish",
    });
    const events = await drain(turn.events);

    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "message-done",
      "done",
    ]);
    expect(
      (events[1] as Extract<AgentChatRuntimeEvent, { type: "message-delta" }>)
        .delta,
    ).toEqual({ type: "text", text: "Done" });
  });
});

describe("createAgentNativeChatRuntime", () => {
  it("wraps the existing Agent Native chat endpoint and normalizes SSE events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "text", text: "Looking" },
        { type: "tool_start", id: "tool-1", tool: "list-forms", input: {} },
        {
          type: "tool_done",
          id: "tool-1",
          tool: "list-forms",
          result: "ok",
        },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-forms",
      mode: "plan",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "How many forms?",
    });
    const events = await drain(turn.events);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      message: "How many forms?",
      threadId: "thread-forms",
      mode: "plan",
      turnId: turn.id,
    });
    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "tool-start",
      "tool-done",
      "message-done",
      "done",
    ]);
  });
});

describe("createAgentChatRuntimeAdapter", () => {
  it("adapts runtime events into assistant-ui content", async () => {
    const runtime: AgentChatRuntime = {
      id: "external:test",
      kind: "external-agent",
      label: "Test",
      capabilities: {
        messages: { streaming: true },
        sessions: { create: true },
      },
      async createSession() {
        return {
          id: "session-1",
          runtimeId: "external:test",
          async startTurn(input) {
            async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
              yield {
                type: "message-delta",
                messageId: "m1",
                delta: { type: "text", text: input.prompt ?? "" },
              };
              yield {
                type: "tool-start",
                toolCall: {
                  id: "tool-1",
                  name: "query",
                  input: { q: "forms" },
                },
              };
              yield {
                type: "tool-done",
                toolCallId: "tool-1",
                toolName: "query",
                status: "completed",
                resultText: "34 rows",
              };
              yield { type: "done", reason: "complete" };
            }
            return {
              id: "turn-1",
              sessionId: "session-1",
              runId: "run-1",
              events: events(),
            };
          },
        };
      },
    };
    const adapter = createAgentChatRuntimeAdapter(runtime);

    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Show forms" }],
          },
        ],
        abortSignal: new AbortController().signal,
        runConfig: {},
      } as any),
    );

    expect(results.at(-1)).toMatchObject({
      content: [
        { type: "text", text: "Show forms" },
        {
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "query",
          result: "34 rows",
        },
      ],
      metadata: { custom: { runtimeId: "external:test", runId: "run-1" } },
    });
  });

  it("does not reuse an already-aborted signal for explicit cancel", async () => {
    const abortController = new AbortController();
    let cancelInput: Parameters<NonNullable<AgentChatRuntimeTurn["cancel"]>>[0];
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const runtime: AgentChatRuntime = {
      id: "external:test",
      kind: "external-agent",
      label: "Test runtime",
      capabilities: {
        messages: { streaming: true, history: true },
        cancellation: { abortSignal: true, explicitCancel: true },
      },
      async createSession() {
        return {
          id: "session-1",
          runtimeId: "external:test",
          async startTurn() {
            async function* events(): AsyncIterable<AgentChatRuntimeEvent> {
              throw abortError;
            }
            return {
              id: "turn-1",
              sessionId: "session-1",
              runId: "run-1",
              events: events(),
              cancel: async (input) => {
                cancelInput = input;
                return { status: "cancelled" };
              },
            };
          },
        };
      },
    };
    const adapter = createAgentChatRuntimeAdapter(runtime);

    abortController.abort();
    const results = await drain(
      adapter.run({
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Stop" }],
          },
        ],
        abortSignal: abortController.signal,
        runConfig: {},
      } as any),
    );

    expect(results).toEqual([]);
    expect(cancelInput).toEqual({ reason: "abort" });
  });
});
