import { AgentKitRunSlotBusyError } from "@agent-native/agentkit/client";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  subscribeChatFirstOpenApp,
  subscribeChatFirstOpenBrowser,
} from "../chat-first-state.js";
import type { AgentChatRuntime as AgentChatRuntimeFromClientBarrel } from "../index.js";
import type { AgentChatRuntime as AgentChatRuntimeFromChatBarrel } from "./index.js";
import {
  createAgentNativeChatRuntime,
  createHttpAgentChatRuntime,
  type AgentChatRuntime,
  type AgentChatRuntimeEvent,
  type AgentChatRuntimeKnownEvent,
  type AgentChatRuntimeMessage,
  type AgentChatRuntimeToolCall,
  type AgentChatRuntimeTurn,
  type AgentChatRuntimeTurnInput,
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

  it("explains oversized requests and marks them non-retryable", async () => {
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: vi
        .fn()
        .mockResolvedValue(
          new Response("Payload too large", { status: 413 }),
        ) as typeof fetch,
    });

    await expect(
      (await runtime.createSession()).startTurn({ prompt: "finish" }),
    ).rejects.toMatchObject({
      message:
        "This request exceeded the server's size limit (HTTP 413). Start a new chat or remove large attachments or references, then retry.",
      code: "http_413",
      status: 413,
      retryable: false,
    });
  });

  it("forgets turn context when endpoint setup throws", async () => {
    const fetchMock = vi.fn();
    const continuedInputs: Array<AgentChatRuntimeTurnInput | undefined> = [];
    const runtime = createHttpAgentChatRuntime({
      endpoint: ({ turn }) => {
        if (turn.prompt === "Fail before the request") {
          throw new Error("Endpoint setup failed");
        }
        return "/agent/chat";
      },
      fetch: fetchMock as typeof fetch,
      continueTurn: ({ continuation, previousTurn }) => {
        continuedInputs.push(previousTurn);
        return {
          id: continuation.turnId ?? "continued-turn",
          sessionId: "thread-1",
          events:
            (async function* (): AsyncIterable<AgentChatRuntimeEvent> {})(),
        };
      },
    });
    const session = await runtime.createSession({ id: "thread-1" });

    await expect(
      session.startTurn({
        prompt: "Fail before the request",
        queuePromotion: {
          messageId: "failed-message",
          claimId: "failed-claim",
          turnId: "failed-turn",
        },
      }),
    ).rejects.toThrow("Endpoint setup failed");

    await session.continueTurn?.({
      turnId: "failed-turn",
      prompt: "Continue the failed turn",
    });
    await session.continueTurn?.({ prompt: "Continue the latest turn" });

    expect(continuedInputs).toEqual([undefined, undefined]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves setup error codes from non-streaming HTTP failures", async () => {
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 403,
              statusMessage: "Connect an AI provider before chatting.",
              data: { code: "AGENT_CHAT_AI_SETUP_REQUIRED" },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
      ) as typeof fetch,
    });

    await expect(
      (await runtime.createSession({ id: "thread-1" })).startTurn({
        prompt: "Update the slide",
      }),
    ).rejects.toMatchObject({
      code: "AGENT_CHAT_AI_SETUP_REQUIRED",
      status: 403,
    });
  });

  it("maps a run-slot 409 to a retryable AgentKit busy error", async () => {
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 409,
              statusMessage: "Run already in progress",
              data: {
                code: "run_slot_busy",
                activeRunId: "run-active",
                retryable: true,
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ) as typeof fetch,
    });
    let error: unknown;
    try {
      await (
        await runtime.createSession({ id: "thread-1" })
      ).startTurn({
        prompt: "Follow up while another tab is running",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AgentKitRunSlotBusyError);
    expect(error).toMatchObject({
      code: "run_slot_busy",
      activeRunId: "run-active",
      status: 409,
      retryable: true,
    });
  });

  it("maps a top-level typed slot-busy 409 to an AgentKit busy error", async () => {
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Run already in progress for this thread",
              code: "run_slot_busy",
              retryable: true,
              activeRunId: "run-active",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ) as typeof fetch,
    });
    let error: unknown;
    try {
      await (
        await runtime.createSession({ id: "thread-1" })
      ).startTurn({ prompt: "A second message" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AgentKitRunSlotBusyError);
    expect(error).toMatchObject({
      code: "run_slot_busy",
      status: 409,
      retryable: true,
      activeRunId: "run-active",
    });
  });

  it("preserves an explicit non-slot 409 that also includes an active run ID", async () => {
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "revision_conflict",
              activeRunId: "run-active",
              message: "The thread revision changed",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          ),
      ) as typeof fetch,
    });

    await expect(
      (await runtime.createSession({ id: "thread-1" })).startTurn({
        prompt: "Keep this request visible",
      }),
    ).rejects.toMatchObject({
      code: "revision_conflict",
      activeRunId: "run-active",
      status: 409,
    });
  });

  it("lets a transport continue a paused turn with the previous input", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([{ type: "done", reason: "tool-use" }], "run-1"),
      )
      .mockResolvedValueOnce(sseResponse([{ type: "done" }], "run-2"));
    let continuedInput: AgentChatRuntimeTurnInput | undefined;
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: fetchMock as typeof fetch,
      continueTurn: ({ continuation, previousTurn, startTurn }) => {
        continuedInput = previousTurn;
        return startTurn({
          ...previousTurn,
          prompt: continuation.prompt,
        });
      },
    });
    const session = await runtime.createSession({ id: "thread-1" });
    const first = await session.startTurn({ prompt: "Start" });
    await drain(first.events);

    const second = await session.continueTurn?.({ prompt: "Continue" });
    expect(second).toBeDefined();
    await drain(second!.events);

    expect(continuedInput).toMatchObject({ prompt: "Start" });
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      prompt: "Continue",
    });
  });

  it("preserves retryable failure context until a continuation succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          {
            type: "error",
            error: "Temporary failure",
            retryable: true,
          },
          { type: "done", reason: "error" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "done", reason: "complete" }]),
      );
    const continuedInputs: Array<AgentChatRuntimeTurnInput | undefined> = [];
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: fetchMock as typeof fetch,
      continueTurn: ({ continuation, previousTurn, startTurn }) => {
        continuedInputs.push(previousTurn);
        if (!previousTurn) {
          return {
            id: continuation.turnId ?? "missing-previous-turn",
            sessionId: "thread-1",
            events:
              (async function* (): AsyncIterable<AgentChatRuntimeEvent> {})(),
          };
        }
        return startTurn({
          ...previousTurn,
          prompt: continuation.prompt,
        });
      },
    });
    const session = await runtime.createSession({ id: "thread-1" });
    const originalMessages: AgentChatRuntimeMessage[] = [
      {
        id: "prior-user",
        role: "user",
        content: [{ type: "text", text: "Earlier context" }],
      },
    ];
    const first = await session.startTurn({
      prompt: "Original question",
      messages: originalMessages,
      model: "agent-model",
      reasoningEffort: "high",
      temperature: 0.2,
      providerOptions: { source: "browser" },
    });
    await drain(first.events);

    const retry = await session.continueTurn?.({
      turnId: first.id,
      prompt: "Retry question",
    });
    expect(retry).toBeDefined();
    await drain(retry!.events);

    await session.continueTurn?.({
      turnId: first.id,
      prompt: "Retry again",
    });

    expect(continuedInputs[0]).toMatchObject({
      prompt: "Original question",
      messages: originalMessages,
      model: "agent-model",
      reasoningEffort: "high",
      temperature: 0.2,
      providerOptions: { source: "browser" },
    });
    expect(continuedInputs[1]).toBeUndefined();
  });

  it("uses the named turn input after another turn starts in the session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([{ type: "done", reason: "tool-use" }]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "done", reason: "complete" }]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "done", reason: "complete" }]),
      );
    let continuationInput: AgentChatRuntimeTurnInput | undefined;
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: fetchMock as typeof fetch,
      continueTurn: ({ continuation, previousTurn, startTurn }) => {
        continuationInput = previousTurn;
        return startTurn({
          ...previousTurn,
          prompt: continuation.prompt,
        });
      },
    });
    const session = await runtime.createSession({ id: "thread-1" });
    const approvalTurn = await session.startTurn({
      prompt: "Approval prompt",
      queuePromotion: {
        messageId: "approval-message",
        claimId: "approval-claim",
        turnId: "approval-turn",
      },
      metadata: { turnOwner: "approval" },
    });
    await drain(approvalTurn.events);

    const laterTurn = await session.startTurn({
      prompt: "Queued prompt",
      queuePromotion: {
        messageId: "queued-message",
        claimId: "queued-claim",
        turnId: "queued-turn",
      },
      metadata: { turnOwner: "queued" },
    });
    await drain(laterTurn.events);

    const continuation = await session.continueTurn?.({
      turnId: approvalTurn.id,
      prompt: "Continue approval",
    });

    expect(continuationInput).toMatchObject({
      prompt: "Approval prompt",
      metadata: { turnOwner: "approval" },
    });
    expect(continuation?.id).toBe(approvalTurn.id);
    await drain(continuation!.events);
  });
});

describe("createAgentNativeChatRuntime", () => {
  it("keeps the original request context when a run-timeout stream closes without done", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([{ type: "auto_continue", reason: "run_timeout" }]),
      )
      .mockResolvedValueOnce(
        sseResponse([{ type: "done", reason: "complete" }]),
      );
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession({
      threadId: "thread-timeout-context",
    });
    const originalMessages: AgentChatRuntimeMessage[] = [
      {
        id: "prior-user",
        role: "user",
        content: [{ type: "text", text: "Earlier context" }],
      },
    ];
    const first = await session.startTurn({
      prompt: "Original request",
      messages: originalMessages,
      metadata: { source: "browser" },
    });
    const firstEvents = await drain(first.events);

    expect(firstEvents).toMatchObject([{ type: "continuation" }]);
    expect(firstEvents.some((event) => event.type === "done")).toBe(false);

    const continuation = await session.continueTurn?.({
      turnId: first.id,
      prompt: "Continue after the time limit",
    });
    expect(continuation).toBeDefined();
    await drain(continuation!.events);

    const continuationRequest = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    );
    expect(continuationRequest).toMatchObject({
      message: "Continue after the time limit",
      threadId: "thread-timeout-context",
      turnId: first.id,
      history: [{ role: "user", content: "Earlier context" }],
      metadata: { source: "browser" },
    });
  });

  it("sends the browser analytics session with agent-run requests", async () => {
    const storage = new Map<string, string>([
      ["agent-native.session_id", "browser-session-42"],
      ["agent-native.session_last_activity", String(Date.now())],
    ]);
    vi.stubGlobal("window", {
      location: {
        href: "https://app.example.test/chat",
        origin: "https://app.example.test",
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(sseResponse([{ type: "done" }]));
      const runtime = createAgentNativeChatRuntime({
        apiUrl: "/_agent-native/agent-chat",
        fetch: fetchMock as typeof fetch,
      });
      const session = await runtime.createSession();
      await drain(
        (await session.startTurn({ prompt: "Create a slide" })).events,
      );

      expect(
        new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(
          "x-agent-native-session-id",
        ),
      ).toBe("browser-session-42");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits the browser analytics session from cross-origin agent chat requests", async () => {
    const storage = new Map<string, string>([
      ["agent-native.session_id", "browser-session-42"],
      ["agent-native.session_last_activity", String(Date.now())],
    ]);
    vi.stubGlobal("window", {
      location: {
        href: "https://app.example.test/chat",
        origin: "https://app.example.test",
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    try {
      const apiUrl = "https://chat.example.test/_agent-native/agent-chat";
      const fetchMock = vi
        .fn()
        .mockResolvedValue(sseResponse([{ type: "done" }]));
      const runtime = createAgentNativeChatRuntime({
        apiUrl,
        fetch: fetchMock as typeof fetch,
      });
      const session = await runtime.createSession();
      await drain(
        (await session.startTurn({ prompt: "Create a slide" })).events,
      );

      const chatRequest = fetchMock.mock.calls.find(
        ([input]) => String(input) === apiUrl,
      )?.[1];
      expect(
        new Headers(chatRequest?.headers).get("x-agent-native-session-id"),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends prior tool activity as structured history without duplicating the current prompt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-history",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession();
    const messages: AgentChatRuntimeMessage[] = [
      {
        id: "user-old",
        role: "user",
        content: [{ type: "text", text: "Search the project brief" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: [
          { type: "text", text: "I retrieved the document." },
          {
            type: "tool-call",
            toolCallId: "call-document",
            toolName: "get_document",
            input: { documentId: "doc-1" },
          },
          {
            type: "tool-result",
            toolCallId: "call-document",
            toolName: "get_document",
            result: "Document title: Project Brief",
          },
          { type: "text", text: "The document title is Project Brief." },
          {
            type: "tool-call",
            toolCallId: "call-search",
            toolName: "docs-search",
            input: { query: "project brief" },
          },
          {
            type: "tool-result",
            toolCallId: "call-search",
            toolName: "docs-search",
            result: "Partial search results",
            resultText: "Tool error: Provider timed out.",
            isError: true,
          },
          {
            type: "tool-call",
            toolCallId: "call-large-input",
            toolName: "docs-search",
            inputText:
              "Tool input omitted from history because it exceeds 64 KiB.",
          },
          {
            type: "tool-result",
            toolCallId: "call-large-input",
            toolName: "docs-search",
            result: "Search completed.",
          },
        ],
      },
      {
        id: "user-current",
        role: "user",
        content: [{ type: "text", text: "Which tools did you call?" }],
      },
    ];

    const turn = await session.startTurn({
      prompt: "Which tools did you call?",
      messages,
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.structuredHistory).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Search the project brief" }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I retrieved the document." },
          {
            type: "tool-call",
            id: "call-document",
            name: "get_document",
            input: { documentId: "doc-1" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-document",
            toolName: "get_document",
            content: "Document title: Project Brief",
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "The document title is Project Brief." },
          {
            type: "tool-call",
            id: "call-search",
            name: "docs-search",
            input: { query: "project brief" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-search",
            toolName: "docs-search",
            content: "Partial search results\nTool error: Provider timed out.",
            isError: true,
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Tool input omitted from history because it exceeds 64 KiB.",
          },
          {
            type: "tool-call",
            id: "call-large-input",
            name: "docs-search",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-large-input",
            toolName: "docs-search",
            content: "Search completed.",
          },
        ],
      },
    ]);
    expect(body.structuredHistory).not.toContainEqual(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            text: "Which tools did you call?",
          }),
        ]),
      }),
    );
  });

  it("excludes the current prompt when a synthetic tool-history notice follows it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-tool-history-omission-prompt-boundary",
      fetch: fetchMock as typeof fetch,
    });
    const prompt = "Which tools did you call?";
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt,
      messages: [
        {
          id: "user-prior",
          role: "user",
          content: [{ type: "text", text: "Search the project brief" }],
        },
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-document",
              toolName: "get_document",
              input: { documentId: "doc-1" },
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: prompt }],
        },
        {
          id: "agentkit-tool-history-omission",
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Some tool-call history was omitted to keep the added history under 256 KiB and 64 calls.",
            },
          ],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.history).not.toContainEqual(
      expect.objectContaining({ content: prompt }),
    );
    expect(body.structuredHistory).not.toContainEqual(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: "text", text: prompt }),
        ]),
      }),
    );
  });

  it("keeps assistant conclusion text after its tool result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-tool-result-conclusion-order",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "What did the search find?",
      messages: [
        {
          id: "assistant-completed-tool",
          role: "assistant",
          content: [
            { type: "text", text: "I will search." },
            {
              type: "tool-call",
              toolCallId: "call-search",
              toolName: "search",
              input: { query: "release" },
            },
            {
              type: "tool-result",
              toolCallId: "call-search",
              toolName: "search",
              result: "The release is ready.",
            },
            { type: "text", text: "The release is ready to publish." },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "What did the search find?" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.structuredHistory).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will search." },
          {
            type: "tool-call",
            id: "call-search",
            name: "search",
            input: { query: "release" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-search",
            toolName: "search",
            content: "The release is ready.",
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "The release is ready to publish." }],
      },
    ]);
  });

  it("bounds non-serializable tool inputs and results in structured history", async () => {
    const cyclicInput: Record<string, unknown> = {};
    cyclicInput.self = cyclicInput;
    const cyclicResult: Record<string, unknown> = {};
    cyclicResult.self = cyclicResult;
    const oversizedInput = "x".repeat(64 * 1024);
    const oversizedResult = "y".repeat(64 * 1024 + 1);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-non-serializable-history",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession();
    const turn = await session.startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-cyclic-input",
              toolName: "cyclic-input",
              input: cyclicInput,
            },
            {
              type: "tool-call",
              toolCallId: "call-bigint-input",
              toolName: "bigint-input",
              input: 1n,
            },
            {
              type: "tool-call",
              toolCallId: "call-oversized-input",
              toolName: "oversized-input",
              input: oversizedInput,
            },
            {
              type: "tool-result",
              toolCallId: "call-cyclic-result",
              result: cyclicResult,
              resultText: "The cyclic tool result was omitted.",
            },
            {
              type: "tool-result",
              toolCallId: "call-bigint-result",
              result: 1n,
              resultText: "x".repeat(4 * 1024 + 1),
            },
            {
              type: "tool-result",
              toolCallId: "call-oversized-result",
              result: oversizedResult,
              resultText: "The result exceeded the per-value size limit.",
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.structuredHistory).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Tool input omitted from history because it could not be serialized.",
          },
          { type: "tool-call", id: "call-cyclic-input", name: "cyclic-input" },
          {
            type: "text",
            text: "Tool input omitted from history because it could not be serialized.",
          },
          { type: "tool-call", id: "call-bigint-input", name: "bigint-input" },
          {
            type: "text",
            text: "Tool input omitted from history because it exceeds 64 KiB.",
          },
          {
            type: "tool-call",
            id: "call-oversized-input",
            name: "oversized-input",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-cyclic-result",
            content:
              "Tool result omitted from history because it could not be serialized.\nThe cyclic tool result was omitted.",
          },
          {
            type: "tool-result",
            toolCallId: "call-bigint-result",
            content:
              "Tool result omitted from history because it could not be serialized.",
          },
          {
            type: "tool-result",
            toolCallId: "call-oversized-result",
            content:
              "Tool result omitted from history because it exceeds 64 KiB.\nThe result exceeded the per-value size limit.",
          },
        ],
      },
    ]);
  });

  it("stops serializing nested tool values when they exceed 64 KiB", async () => {
    let inputTailRead = false;
    let resultTailRead = false;
    const nestedInput: Record<string, unknown> = {
      nested: { values: Array.from({ length: 20_000 }, (_, index) => index) },
    };
    Object.defineProperty(nestedInput, "late", {
      enumerable: true,
      get() {
        inputTailRead = true;
        return "late input";
      },
    });
    const nestedResult: Record<string, unknown> = {
      nested: { values: Array.from({ length: 20_000 }, (_, index) => index) },
    };
    Object.defineProperty(nestedResult, "late", {
      enumerable: true,
      get() {
        resultTailRead = true;
        return "late result";
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-bounded-json-serialization",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-large-nested-input",
              toolName: "search",
              input: nestedInput,
            },
            {
              type: "tool-result",
              toolCallId: "call-large-nested-result",
              result: nestedResult,
              resultText: "Bounded result summary.",
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const parts = (
      body.structuredHistory as Array<{
        content: Array<{ type: string; text?: string; content?: string }>;
      }>
    ).flatMap((message) => message.content);

    expect(inputTailRead).toBe(false);
    expect(resultTailRead).toBe(false);
    expect(parts).toContainEqual({
      type: "text",
      text: "Tool input omitted from history because it exceeds 64 KiB.",
    });
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        content:
          "Tool result omitted from history because it exceeds 64 KiB.\nBounded result summary.",
      }),
    );
  });

  it("measures escaped JSON bytes for tool input and result strings", async () => {
    const escapeHeavy = "\u0001".repeat(11 * 1024);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-escaped-json-value-cap",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-escaped-input",
              toolName: "search",
              input: escapeHeavy,
            },
            {
              type: "tool-result",
              toolCallId: "call-escaped-result",
              result: escapeHeavy,
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const parts = (
      body.structuredHistory as Array<{
        content: Array<{ type: string; text?: string; content?: string }>;
      }>
    ).flatMap((message) => message.content);

    expect(parts).toContainEqual({
      type: "text",
      text: "Tool input omitted from history because it exceeds 64 KiB.",
    });
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        content: "Tool result omitted from history because it exceeds 64 KiB.",
      }),
    );
  });

  it("bounds omitted-property and deeply nested tool serialization work", async () => {
    let latePropertyRead = false;
    const omittedProperties: Record<string, unknown> = {};
    for (let index = 0; index < 40_000; index++) {
      const value = index % 3;
      omittedProperties[`omitted-${index}`] =
        value === 0 ? undefined : value === 1 ? () => undefined : Symbol();
    }
    Object.defineProperty(omittedProperties, "late", {
      enumerable: true,
      get() {
        latePropertyRead = true;
        return "late value";
      },
    });
    const objectKeys = Object.keys;
    const objectKeysSpy = vi.spyOn(Object, "keys");
    objectKeysSpy.mockImplementation((value: object) => {
      if (value === omittedProperties) {
        throw new Error("Object.keys must not materialize bounded input keys");
      }
      return objectKeys(value);
    });

    let deeplyNested: unknown = "leaf";
    for (let index = 0; index < 600; index++) {
      deeplyNested = { child: deeplyNested };
    }
    let toJSONReceiver: unknown;
    const toJSON = Object.assign(
      function (this: unknown) {
        toJSONReceiver = this;
        return { serialized: true };
      },
      {
        call: () => {
          throw new Error("toJSON.call must not be invoked");
        },
      },
    );
    const functionWithToJSON = Object.assign(() => undefined, { toJSON });

    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-bounded-serialization-work",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-many-omissions",
              toolName: "search",
              input: omittedProperties,
            },
            {
              type: "tool-call",
              toolCallId: "call-deep-value",
              toolName: "search",
              input: deeplyNested,
            },
            {
              type: "tool-call",
              toolCallId: "call-function-to-json",
              toolName: "search",
              input: functionWithToJSON,
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    try {
      await drain(turn.events);
    } finally {
      objectKeysSpy.mockRestore();
    }

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const parts = (
      body.structuredHistory as Array<{
        content: Array<{
          type: string;
          id?: string;
          input?: unknown;
          text?: string;
        }>;
      }>
    ).flatMap((message) => message.content);

    expect(latePropertyRead).toBe(false);
    expect(toJSONReceiver).toBe(functionWithToJSON);
    expect(
      parts.filter(
        (part) =>
          part.text ===
          "Tool input omitted from history because serialization exceeded its work limit.",
      ),
    ).toHaveLength(2);
    expect(parts).toContainEqual({
      type: "tool-call",
      id: "call-function-to-json",
      name: "search",
      input: { serialized: true },
    });
  });

  it("reads each enumerable proxy property once like JSON.stringify", async () => {
    let descriptorReads = 0;
    const proxyInput = new Proxy(
      {},
      {
        ownKeys: () => ["value"],
        getOwnPropertyDescriptor: (_target, key) => {
          if (key !== "value") return undefined;
          descriptorReads++;
          return descriptorReads === 1
            ? { configurable: true, enumerable: true, value: 1, writable: true }
            : undefined;
        },
        get: (_target, key) => (key === "value" ? 1 : undefined),
      },
    );
    const expected = JSON.stringify(proxyInput);
    descriptorReads = 0;

    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-proxy-tool-history",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-proxy-input",
              toolName: "search",
              input: proxyInput,
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const toolCall = (
      body.structuredHistory as Array<{
        content: Array<{ type: string; id?: string; input?: unknown }>;
      }>
    )
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool-call");

    expect(descriptorReads).toBe(1);
    expect(toolCall).toMatchObject({
      id: "call-proxy-input",
      input: JSON.parse(expected!),
    });
  });

  it("keeps inherited properties out of bounded tool JSON", async () => {
    const input = Object.assign(Object.create({ inherited: "omit" }), {
      own: "keep",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-inherited-tool-property",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-inherited-property",
              toolName: "search",
              input,
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const toolCall = (
      body.structuredHistory as Array<{
        content: Array<{ type: string; id?: string; input?: unknown }>;
      }>
    )
      .flatMap((message) => message.content)
      .find((part) => part.type === "tool-call");

    expect(toolCall).toMatchObject({
      id: "call-inherited-property",
      input: { own: "keep" },
    });
  });

  it("bounds whitespace history and result summaries before adding them", async () => {
    const whitespaceText = " ".repeat(300 * 1024);
    const whitespaceInputText = " ".repeat(70 * 1024);
    const whitespaceResultText = " ".repeat(70 * 1024);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-bounded-whitespace-history",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            { type: "text", text: whitespaceText },
            {
              type: "tool-call",
              toolCallId: "call-whitespace-input-text",
              toolName: "search",
              inputText: whitespaceInputText,
            },
            {
              type: "tool-result",
              toolCallId: "call-whitespace-result-text",
              result: { found: true },
              resultText: whitespaceResultText,
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const parts = (
      body.structuredHistory as Array<{
        content: Array<{ type: string; text?: string; content?: string }>;
      }>
    ).flatMap((message) => message.content);

    expect(parts).not.toContainEqual({ type: "text", text: whitespaceText });
    expect(parts).toContainEqual({
      type: "text",
      text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
    });
    expect(parts).toContainEqual({
      type: "text",
      text: "Tool input omitted from history because it exceeds 64 KiB.",
    });
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-whitespace-result-text",
        content: "Tool result omitted from history because it exceeds 64 KiB.",
      }),
    );
  });

  it("projects only a bounded suffix of prior structured tool history", async () => {
    let discardedInputRead = false;
    const oldestCall = {
      type: "tool-call" as const,
      toolCallId: "call-0",
      toolName: "search",
      input: {},
    };
    Object.defineProperty(oldestCall, "input", {
      enumerable: true,
      get() {
        discardedInputRead = true;
        return { query: "discarded" };
      },
    });
    const toolContent = [
      oldestCall,
      ...Array.from({ length: 70 }, (_, index) => {
        const id = `call-${index + 1}`;
        return [
          {
            type: "tool-call" as const,
            toolCallId: id,
            toolName: "search",
            input: { query: id },
          },
          {
            type: "tool-result" as const,
            toolCallId: id,
            result: { result: id },
          },
        ];
      }).flat(),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-bounded-source-window",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        { id: "assistant-tools", role: "assistant", content: toolContent },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const history = body.structuredHistory as Array<{
      role: "user" | "assistant";
      content: Array<{ type: string; id?: string; text?: string }>;
    }>;
    const parts = history.flatMap((message) => message.content);
    const calls = parts.filter((part) => part.type === "tool-call");

    expect(discardedInputRead).toBe(false);
    expect(calls).toHaveLength(64);
    expect(calls[0]?.id).toBe("call-7");
    expect(calls.at(-1)?.id).toBe("call-70");
    expect(history.at(-1)).toEqual({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
        },
      ],
    });
  });

  it("keeps the newest tool window when recent text is interleaved", async () => {
    const toolAndTextContent = [
      ...Array.from({ length: 65 }, (_, index) => {
        const id = `call-${index + 1}`;
        return [
          {
            type: "tool-call" as const,
            toolCallId: id,
            toolName: "search",
            input: { query: id },
          },
          {
            type: "tool-result" as const,
            toolCallId: id,
            result: { result: id },
          },
        ];
      }).flat(),
      ...Array.from({ length: 200 }, (_, index) => ({
        type: index % 2 ? ("reasoning" as const) : ("text" as const),
        text: `Recent note ${index}.`,
      })),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-tool-window-with-recent-text",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools-and-text",
          role: "assistant",
          content: toolAndTextContent,
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const parts = (
      body.structuredHistory as Array<{
        content: Array<{ type: string; id?: string }>;
      }>
    ).flatMap((message) => message.content);
    const calls = parts.filter((part) => part.type === "tool-call");
    const results = parts.filter((part) => part.type === "tool-result");

    expect(calls).toHaveLength(64);
    expect(calls[0]?.id).toBe("call-2");
    expect(calls.at(-1)?.id).toBe("call-65");
    expect(results).toHaveLength(64);
  });

  it("omits unmatched boundary results when their calls fall outside the source window", async () => {
    let boundaryResultRead = false;
    const boundaryCall = {
      type: "tool-call" as const,
      toolCallId: "call-boundary",
      toolName: "search",
      input: { query: "boundary" },
    };
    const boundaryResult = {
      type: "tool-result" as const,
      toolCallId: "call-boundary",
      result: "boundary result",
    };
    Object.defineProperty(boundaryResult, "result", {
      enumerable: true,
      get() {
        boundaryResultRead = true;
        return "boundary result";
      },
    });
    const toolContent = [
      boundaryCall,
      ...Array.from({ length: 64 }, (_, index) => {
        const id = `call-${index}`;
        return [
          {
            type: "tool-call" as const,
            toolCallId: id,
            toolName: "search",
            input: { query: id },
          },
          {
            type: "tool-result" as const,
            toolCallId: id,
            result: `result-${id}`,
          },
        ];
      }).flat(),
      boundaryResult,
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-truncated-boundary-result",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        { id: "assistant-tools", role: "assistant", content: toolContent },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const history = body.structuredHistory as Array<{
      role: "user" | "assistant";
      content: Array<{ type: string; toolCallId?: string; text?: string }>;
    }>;
    const parts = history.flatMap((message) => message.content);
    const calls = parts.filter((part) => part.type === "tool-call");
    const results = parts.filter((part) => part.type === "tool-result");

    expect(boundaryResultRead).toBe(false);
    expect(calls).toHaveLength(63);
    expect(results).toHaveLength(63);
    expect(results.some((part) => part.toolCallId === "call-boundary")).toBe(
      false,
    );
    expect(history.at(-1)?.role).toBe("assistant");
    expect(parts).toContainEqual({
      type: "text",
      text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
    });
  });

  it("caps direct runtime tool history at 64 calls", async () => {
    const toolContent = Array.from({ length: 65 }, (_, index) => {
      const id = `call-${index}`;
      return [
        {
          type: "tool-call" as const,
          toolCallId: id,
          toolName: "search",
          input: { query: id },
        },
        {
          type: "tool-result" as const,
          toolCallId: id,
          toolName: "search",
          result: { result: id },
        },
      ];
    }).flat();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-tool-history-call-cap",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: toolContent,
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const history = body.structuredHistory as Array<{
      content: Array<{
        type: string;
        id?: string;
        text?: string;
        toolCallId?: string;
      }>;
    }>;
    const parts = history.flatMap((message) => message.content);
    const calls = parts.filter((part) => part.type === "tool-call");
    const results = parts.filter((part) => part.type === "tool-result");
    const omission = parts.find(
      (part) =>
        part.text ===
        "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
    );

    expect(calls).toHaveLength(64);
    expect(calls[0]?.id).toBe("call-1");
    expect(calls.at(-1)?.id).toBe("call-64");
    expect(results).toHaveLength(64);
    expect(omission).toBeDefined();
  });

  it("caps direct runtime orphan tool results at 64 entries", async () => {
    const results = Array.from({ length: 129 }, (_, index) => ({
      type: "tool-result" as const,
      toolCallId: `orphan-${index}`,
      result: `result-${index}`,
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-orphan-result-cap",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-results",
          role: "assistant",
          content: results,
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const parts = (
      body.structuredHistory as Array<{
        content: Array<{
          type: string;
          toolCallId?: string;
          text?: string;
        }>;
      }>
    ).flatMap((message) => message.content);
    const toolResults = parts.filter((part) => part.type === "tool-result");

    expect(toolResults).toHaveLength(64);
    expect(toolResults[0]?.toolCallId).toBe("orphan-65");
    expect(toolResults.at(-1)?.toolCallId).toBe("orphan-128");
    expect(parts).toContainEqual({
      type: "text",
      text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
    });
  });

  it("caps direct runtime tool history at 256 KiB", async () => {
    const largeInput = "x".repeat(60 * 1024);
    const toolContent = Array.from({ length: 5 }, (_, index) => {
      const id = `call-${index}`;
      return [
        {
          type: "tool-call" as const,
          toolCallId: id,
          toolName: "search",
          input: largeInput,
        },
        {
          type: "tool-result" as const,
          toolCallId: id,
          toolName: "search",
          result: { result: id },
        },
      ];
    }).flat();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-tool-history-byte-cap",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: toolContent,
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const history = body.structuredHistory as Array<{
      content: Array<{ type: string; text?: string }>;
    }>;
    const parts = history.flatMap((message) => message.content);
    const calls = parts.filter((part) => part.type === "tool-call");
    const results = parts.filter((part) => part.type === "tool-result");
    const historyBytes = new TextEncoder().encode(
      JSON.stringify(body.structuredHistory),
    ).byteLength;

    expect(calls.length).toBeLessThan(5);
    expect(results).toHaveLength(calls.length);
    expect(historyBytes).toBeLessThanOrEqual(256 * 1024);
    expect(parts).toContainEqual({
      type: "text",
      text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
    });
  });

  it("includes copied prior text and reasoning in the structured history byte cap", async () => {
    const largeUserText = "u".repeat(140 * 1024);
    const largeAssistantReasoning = "r".repeat(140 * 1024);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-tool-history-with-text-cap",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "user-old",
          role: "user",
          content: [{ type: "text", text: largeUserText }],
        },
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            { type: "reasoning", text: largeAssistantReasoning },
            {
              type: "tool-call",
              toolCallId: "call-latest",
              toolName: "search",
              input: { query: "latest" },
            },
            {
              type: "tool-result",
              toolCallId: "call-latest",
              toolName: "search",
              result: "Found the latest result.",
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const history = body.structuredHistory as Array<{
      role: "user" | "assistant";
      content: Array<{
        type: string;
        id?: string;
        text?: string;
        toolCallId?: string;
      }>;
    }>;
    const parts = history.flatMap((message) => message.content);
    const historyBytes = new TextEncoder().encode(
      JSON.stringify(body.structuredHistory),
    ).byteLength;

    expect(historyBytes).toBeLessThanOrEqual(256 * 1024);
    expect(parts).toContainEqual(
      expect.objectContaining({ type: "tool-call", id: "call-latest" }),
    );
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-latest",
      }),
    );
    expect(parts).toContainEqual({
      type: "text",
      text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
    });
    expect(history.at(-1)).toEqual({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
        },
      ],
    });
    expect(parts).not.toContainEqual(
      expect.objectContaining({ text: largeUserText }),
    );
  });

  it("omits oversized tool-call and result identifiers and names", async () => {
    const oversizedId = "i".repeat(64 * 1024 + 1);
    const oversizedName = "n".repeat(64 * 1024 + 1);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-tool-history-metadata-cap",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Continue",
      messages: [
        {
          id: "assistant-tools",
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: oversizedId,
              toolName: "search",
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: oversizedId,
              toolName: "search",
              result: "Omit this result.",
            },
            {
              type: "tool-call",
              toolCallId: "call-large-name",
              toolName: oversizedName,
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: "call-large-name",
              toolName: oversizedName,
              result: "Omit this result too.",
            },
            {
              type: "tool-call",
              toolCallId: "call-large-result-name",
              toolName: "search",
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: "call-large-result-name",
              toolName: oversizedName,
              result: "Omit this result as well.",
            },
            {
              type: "tool-call",
              toolCallId: "call-valid",
              toolName: "search",
              input: {},
            },
            {
              type: "tool-result",
              toolCallId: "call-valid",
              toolName: "search",
              result: "Keep this result.",
            },
          ],
        },
        {
          id: "user-current",
          role: "user",
          content: [{ type: "text", text: "Continue" }],
        },
      ],
    });
    await drain(turn.events);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const serializedHistory = JSON.stringify(body.structuredHistory);
    const parts = (
      body.structuredHistory as Array<{
        content: Array<{
          type: string;
          id?: string;
          name?: string;
          toolCallId?: string;
          toolName?: string;
          text?: string;
        }>;
      }>
    ).flatMap((message) => message.content);

    expect(serializedHistory).not.toContain(oversizedId);
    expect(serializedHistory).not.toContain(oversizedName);
    expect(
      parts.filter(
        (part) =>
          part.text ===
          "Tool call omitted from history because its ID or name exceeds 64 KiB.",
      ),
    ).toHaveLength(2);
    expect(
      parts.filter(
        (part) =>
          part.text ===
          "Tool result omitted from history because its ID or name exceeds 64 KiB.",
      ),
    ).toHaveLength(3);
    expect(
      parts.filter((part) => part.type === "tool-call").map((part) => part.id),
    ).toEqual(["call-large-result-name", "call-valid"]);
    expect(
      parts
        .filter((part) => part.type === "tool-result")
        .map((part) => part.toolCallId),
    ).toEqual(["call-valid"]);
  });

  it("wraps the existing Agent-Native chat endpoint and normalizes SSE events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "thinking",
          text: "Inspecting ",
          partId: "reasoning-1",
        },
        {
          type: "reasoning",
          text: "the schema.",
          partId: "reasoning-1",
          signature: "sig-native",
        },
        { type: "text", text: "Looking" },
        { type: "tool_start", id: "tool-1", tool: "list-forms", input: {} },
        {
          type: "tool_done",
          id: "tool-1",
          tool: "list-forms",
          result: "ok",
        },
        { type: "thinking", text: "Double-checking the result." },
        {
          type: "suggestions",
          suggestions: [
            {
              id: "review-result",
              label: "Review result",
              prompt: "Review the result in detail.",
            },
          ],
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
      "message-delta",
      "message-delta",
      "tool-start",
      "tool-done",
      "message-delta",
      "suggestions",
      "message-done",
      "done",
    ]);
    expect(events[1]).toMatchObject({
      type: "message-delta",
      delta: {
        type: "reasoning",
        text: "Inspecting ",
        partId: "reasoning-1",
      },
    });
    expect(events[2]).toMatchObject({
      type: "message-delta",
      delta: {
        type: "reasoning",
        text: "the schema.",
        partId: "reasoning-1",
        signature: "sig-native",
      },
    });
    expect(events.at(-2)).toMatchObject({
      type: "message-done",
      message: {
        content: [
          {
            type: "reasoning",
            id: "reasoning-1",
            text: "Inspecting the schema.",
            signature: "sig-native",
          },
          { type: "text", text: "Looking" },
          { type: "reasoning", text: "Double-checking the result." },
          {
            type: "text",
            text: "The agent completed the list forms action, but stopped before sending a final message. Review the completed tool card above or ask the agent to continue.",
          },
        ],
      },
    });
    expect(events.at(-3)).toMatchObject({
      type: "suggestions",
      suggestions: [
        {
          id: "review-result",
          label: "Review result",
          prompt: "Review the result in detail.",
        },
      ],
    });
  });

  it("forwards queued promotion identity with a stable turn ID", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-queued",
      fetch: fetchMock as typeof fetch,
    });
    const turn = await (
      await runtime.createSession()
    ).startTurn({
      prompt: "Run the queued prompt",
      queuePromotion: {
        messageId: "queued-1",
        claimId: "claim-1",
        turnId: "queue-queued-1",
      },
    });

    await drain(turn.events);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      message: "Run the queued prompt",
      turnId: "queue-queued-1",
      queuedMessageId: "queued-1",
      queuedMessageClaimId: "claim-1",
    });
  });

  it("forwards pending-selection suppression to the agent request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([{ type: "text", text: "Done" }, { type: "done" }]),
      );
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-selection",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession();
    const turn = await session.startTurn({
      prompt: "Use this selection once",
      metadata: { agentNativeSkipPendingSelectionContext: true },
    });
    await drain(turn.events);

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      message: "Use this selection once",
      skipPendingSelectionContext: true,
    });
  });

  it("forwards the selected engine from turn metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      engine: "configured-engine",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession();
    const turn = await session.startTurn({
      prompt: "Use the selected engine",
      metadata: { engine: "selected-engine" },
    });
    await drain(turn.events);

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      message: "Use the selected engine",
      engine: "selected-engine",
      metadata: { engine: "selected-engine" },
    });
  });

  it("forwards the submitted AgentKit message ID to durable chat persistence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([{ type: "done" }], "run-identity"));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession({ id: "thread-identity" });
    const turn = await session.startTurn({
      prompt: "Submit this message",
      messages: [
        {
          id: "message-agentkit-1",
          role: "user",
          content: [{ type: "text", text: "Submit this message" }],
        },
      ],
    });
    await drain(turn.events);

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      message: "Submit this message",
      agentKitMessageId: "message-agentkit-1",
    });
  });

  it("preserves workspace connection source metadata in connection requests", async () => {
    const source = {
      id: "google_drive",
      kind: "workspace_connection",
      label: "Google Drive",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "connection_required",
          requestId: "request-google-drive",
          provider: "google_drive",
          connectionReason: "connect",
          appId: "dispatch",
          source,
        },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      fetch: fetchMock as typeof fetch,
    });

    const events = await drain(
      (
        await (await runtime.createSession()).startTurn({
          prompt: "Read this Google Doc",
        })
      ).events,
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "connection-request",
        requestId: "request-google-drive",
        source,
      }),
    );
  });

  it("keeps raw structured action results separate from display text", async () => {
    const result = {
      draft: { subject: "Launch notes" },
      deepLink: "/_agent-native/open?composeDraftId=draft-1",
    };
    const resultText = JSON.stringify(result, null, 2);
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "tool_start", id: "tool-1", tool: "manage-draft", input: {} },
        {
          type: "tool_done",
          id: "tool-1",
          tool: "manage-draft",
          result: resultText,
          chatUI: { renderer: "mail.draft-created" },
          chatUIResult: result,
        },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      fetch: fetchMock as typeof fetch,
    });

    const events = await drain(
      (
        await (await runtime.createSession()).startTurn({
          prompt: "Create a draft",
        })
      ).events,
    );
    const toolDone = events.find((event) => event.type === "tool-done");

    expect(toolDone).toMatchObject({
      result,
      resultText,
      chatUI: { renderer: "mail.draft-created" },
    });
  });

  it("exposes truthful rich capabilities for the Agent-Native stream", () => {
    const runtime = createAgentNativeChatRuntime();

    expect(runtime.capabilities.rich).toEqual({
      annotations: false,
      citations: false,
      widgets: true,
      clientEffects: false,
      uploadProgress: false,
      participants: true,
      interactions: true,
      tasks: true,
      taskGroups: false,
      extensions: true,
      connectionRequests: true,
    });
  });

  it("uses the configured streaming origin after minting a same-origin token", async () => {
    const apiUrl = "/_agent-native/agent-chat";
    const streamingUrl = "https://stream.example.test/agent-chat";
    const storage = new Map<string, string>([
      ["agent-native.session_id", "browser-session-42"],
      ["agent-native.session_last_activity", String(Date.now())],
    ]);
    vi.stubGlobal("window", {
      location: {
        href: "https://app.example.test/chat",
        origin: "https://app.example.test",
      },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    try {
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url === `${apiUrl}/stream-token`) {
            return Response.json({ token: "short-lived-token" });
          }
          if (url === streamingUrl) {
            return sseResponse([
              { type: "text", text: "streamed" },
              { type: "done" },
            ]);
          }
          return sseResponse([
            { type: "text", text: "primary" },
            { type: "done" },
          ]);
        },
      );
      const runtime = createAgentNativeChatRuntime({
        apiUrl,
        streamingUrl,
        fetch: fetchMock as typeof fetch,
      });

      const session = await runtime.createSession({
        threadId: "thread-streaming",
      });
      await drain((await session.startTurn({ prompt: "Stream this" })).events);

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        `${apiUrl}/stream-token`,
        streamingUrl,
      ]);
      const tokenRequest = fetchMock.mock.calls[0]?.[1];
      const streamRequest = fetchMock.mock.calls[1]?.[1];
      expect(tokenRequest).toMatchObject({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      expect(new Headers(streamRequest?.headers).get("Authorization")).toBe(
        "Bearer short-lived-token",
      );
      expect(
        new Headers(streamRequest?.headers).get("x-agent-native-session-id"),
      ).toBeNull();
      expect(streamRequest?.credentials).toBe("omit");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to the primary route when the streaming origin cannot connect", async () => {
    const apiUrl = "/_agent-native/agent-chat";
    const streamingUrl = "https://stream.example.test/agent-chat";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `${apiUrl}/stream-token`) {
          return Response.json({ token: "short-lived-token" });
        }
        if (url === streamingUrl) throw new TypeError("Failed to fetch");
        return sseResponse([
          { type: "text", text: "primary" },
          { type: "done" },
        ]);
      },
    );
    const runtime = createAgentNativeChatRuntime({
      apiUrl,
      streamingUrl,
      fetch: fetchMock as typeof fetch,
    });

    const session = await runtime.createSession({
      threadId: "thread-fallback",
    });
    const events = await drain(
      (await session.startTurn({ prompt: "Use fallback" })).events,
    );

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      `${apiUrl}/stream-token`,
      streamingUrl,
      apiUrl,
    ]);
    expect(events.some((event) => event.type === "message-done")).toBe(true);
  });

  it("keeps legacy status events while adding structured activity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "activity",
          id: "prepare-1",
          label: "Preparing action input",
          tool: "publish-release",
          progressBytes: 512,
          seq: 2,
        },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      fetch: fetchMock as typeof fetch,
    });

    const events = await drain(
      (await (await runtime.createSession()).startTurn({ prompt: "Publish" }))
        .events,
    );

    expect(events).toMatchObject([
      {
        type: "status",
        message: "Preparing action input",
        metadata: {
          seq: 2,
          tool: "publish-release",
          progressBytes: 512,
          compatibilityMirror: "activity",
        },
      },
      {
        type: "activity",
        operation: "update",
        activity: {
          id: "prepare-1",
          kind: "tool",
          label: "Preparing action input",
          status: "running",
          metadata: {
            seq: 2,
            tool: "publish-release",
            progressBytes: 512,
          },
        },
      },
      {
        type: "message-start",
        message: {
          id: expect.any(String),
          role: "assistant",
          content: [],
        },
      },
      {
        type: "message-done",
        message: {
          id: expect.any(String),
          role: "assistant",
          metadata: {
            custom: {
              runWarning: {
                errorCode: "final_response_missing",
                message:
                  "The agent stopped without sending a final message. Ask the agent to continue or retry.",
                recoverable: true,
              },
            },
          },
          content: [
            {
              type: "text",
              text: "The agent stopped without sending a final message. Ask the agent to continue or retry.",
            },
          ],
        },
      },
      { type: "done" },
    ]);
  });

  it("normalizes delegated-agent activity and task lifecycles without flattening them", async () => {
    const snapshot = {
      kind: "agent-native/agent-activity",
      version: 1,
      sequence: 4,
      startedAt: 1_000,
      updatedAt: 2_500,
      durationMs: 1_500,
      activePhase: "tool",
      reasoning: ["Inspect the workspace"],
      toolCalls: [{ name: "read-file", status: "running" }],
    } as const;
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "agent_call",
          agent: "Planck",
          status: "start",
          agentCallId: "agent-call-1",
          taskId: "remote-task-1",
          seq: 1,
        },
        {
          type: "agent_call_progress",
          agent: "Planck",
          agentCallId: "agent-call-1",
          state: "working",
          elapsedSeconds: 12,
          detail: "Reading the protocol contract",
          seq: 2,
        },
        {
          type: "agent_call_text",
          agent: "Planck",
          agentCallId: "agent-call-1",
          text: "Found the runtime boundary.",
          seq: 3,
        },
        {
          type: "agent_call_activity",
          agent: "Planck",
          agentCallId: "agent-call-1",
          snapshot,
          seq: 4,
        },
        {
          type: "agent_call",
          agent: "Planck",
          status: "done",
          agentCallId: "agent-call-1",
          taskId: "remote-task-1",
          durationMs: 1_500,
          terminalCode: "completed",
          seq: 5,
        },
        {
          type: "agent_task",
          taskId: "local-task-1",
          threadId: "thread-rich",
          description: "Review runtime contracts",
          status: "running",
          seq: 6,
        },
        {
          type: "agent_task_update",
          taskId: "local-task-1",
          preview: "Runtime contract located",
          currentStep: "Map event types",
          seq: 7,
        },
        {
          type: "agent_task_complete",
          taskId: "local-task-1",
          summary: "Mapped the runtime contract.",
          seq: 8,
        },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      threadId: "thread-rich",
      fetch: fetchMock as typeof fetch,
    });

    const events = await drain(
      (
        await (await runtime.createSession({ id: "thread-rich" })).startTurn({
          prompt: "Review it",
        })
      ).events,
    );

    expect(events.map((event) => event.type)).toEqual([
      "participant",
      "interaction",
      "task",
      "participant",
      "activity",
      "interaction",
      "activity",
      "participant",
      "interaction",
      "task",
      "task",
      "task",
      "task",
      "message-start",
      "message-done",
      "done",
    ]);
    expect(events[0]).toMatchObject({
      type: "participant",
      operation: "register",
      participant: {
        id: "agent-call-1",
        name: "Planck",
        status: "working",
        activeTaskId: "remote-task-1",
      },
    });
    expect(events[4]).toMatchObject({
      type: "activity",
      activity: {
        id: "agent-call-1:progress",
        detail: "Reading the protocol contract",
        data: { state: "working", elapsedSeconds: 12 },
      },
    });
    expect(events[6]).toMatchObject({
      type: "activity",
      activity: {
        id: "agent-call-1:activity",
        data: snapshot,
        metadata: { sequence: 4, durationMs: 1_500 },
      },
    });
    expect(events[7]).toMatchObject({
      type: "participant",
      operation: "update",
      participant: {
        status: "completed",
        metadata: { durationMs: 1_500, terminalCode: "completed" },
      },
    });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("surfaces native and MCP action renderers as composable widgets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "tool_done",
          id: "tool-1",
          tool: "build-report",
          result: "Report ready",
          chatUI: {
            renderer: "core.data-table",
            title: "Report",
          },
          mcpApp: {
            serverId: "analytics",
            toolName: "build-report",
            originalToolName: "build_report",
            resourceUri: "ui://analytics/report",
            toolInput: { reportId: "report-1" },
            toolResult: { reportId: "report-1" },
          },
        },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      fetch: fetchMock as typeof fetch,
    });

    const events = await drain(
      (await (await runtime.createSession()).startTurn({ prompt: "Build" }))
        .events,
    );

    expect(events.map((event) => event.type)).toEqual([
      "tool-done",
      "widget",
      "widget",
      "message-start",
      "message-done",
      "done",
    ]);
    expect(events[1]).toMatchObject({
      type: "widget",
      widget: {
        id: "tool-1:chat-ui",
        kind: "core.data-table",
        title: "Report",
        data: { toolCallId: "tool-1", toolName: "build-report" },
      },
    });
    expect(events[2]).toMatchObject({
      type: "widget",
      widget: {
        id: "tool-1:mcp-app",
        kind: "mcp-app",
        object: {
          id: "ui://analytics/report",
          kind: "mcp-resource",
        },
      },
    });
  });

  it("forwards only explicit namespaced rich envelopes as extensions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "rich_event",
          seq: 9,
          event: {
            namespace: "com.agent-native.review",
            name: "checkpoint.created",
            version: 1,
            data: { state: "ready" },
            references: [
              {
                kind: "trace",
                id: "trace-1",
                label: "Release trace",
              },
            ],
            metadata: { actionId: "release-review" },
          },
        },
        { type: "unregistered_future_event", payload: "ignored" },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      fetch: fetchMock as typeof fetch,
    });

    const events = await drain(
      (await (await runtime.createSession()).startTurn({ prompt: "Review" }))
        .events,
    );

    expect(events).toEqual([
      {
        type: "extension",
        sessionId: expect.any(String),
        turnId: expect.any(String),
        namespace: "com.agent-native.review",
        name: "checkpoint.created",
        version: 1,
        data: { state: "ready" },
        references: [{ kind: "trace", id: "trace-1", label: "Release trace" }],
        metadata: { seq: 9, actionId: "release-review" },
      },
      {
        type: "message-start",
        sessionId: expect.any(String),
        turnId: expect.any(String),
        message: {
          id: expect.any(String),
          role: "assistant",
          content: [],
        },
      },
      {
        type: "message-done",
        sessionId: expect.any(String),
        turnId: expect.any(String),
        message: {
          id: expect.any(String),
          role: "assistant",
          metadata: {
            custom: {
              runWarning: {
                errorCode: "final_response_missing",
                message:
                  "The agent stopped without sending a final message. Ask the agent to continue or retry.",
                recoverable: true,
              },
            },
          },
          content: [
            {
              type: "text",
              text: "The agent stopped without sending a final message. Ask the agent to continue or retry.",
            },
          ],
        },
      },
      {
        type: "done",
        sessionId: expect.any(String),
        turnId: expect.any(String),
        reason: "complete",
      },
    ]);
  });

  it("carries the model-side toolCallId from approval_required", async () => {
    // The server sends the paused call's id as `toolCallId`, never as `id`.
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "tool_start",
          id: "call-1",
          tool: "start-prospect-run",
          input: {},
        },
        {
          type: "approval_required",
          tool: "start-prospect-run",
          input: {},
          approvalKey: "start-prospect-run:{}",
          toolCallId: "call-1",
          allowPersistentApproval: false,
        },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-approval",
      fetch: fetchMock as typeof fetch,
    });

    const session = await runtime.createSession();
    const turn = await session.startTurn({ prompt: "run it" });
    const events = await drain(turn.events);

    expect(
      events.find((event) => event.type === "approval-request"),
    ).toMatchObject({
      approvalId: "start-prospect-run:{}",
      toolCallId: "call-1",
      toolName: "start-prospect-run",
      allowPersistentApproval: false,
    });
    expect(events.at(-1)).toMatchObject({
      type: "done",
      reason: "tool-use",
    });
    expect(session.continueTurn).toBeTypeOf("function");
  });

  it("resumes the exact approved tool call with false-valued arguments", async () => {
    const approvedInput = { dryRun: false };
    const approvalKey = 'publish-release:{"dryRun":false}';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text", text: "Waiting for approval. " },
          {
            type: "tool_start",
            id: "call-0",
            tool: "read-release",
            input: {},
          },
          {
            type: "tool_done",
            id: "call-0",
            tool: "read-release",
            result: "Release lookup failed.",
            isError: true,
          },
          {
            type: "text",
            text: "Release lookup failed; requesting approval. ",
          },
          {
            type: "tool_start",
            id: "call-1",
            tool: "publish-release",
            input: approvedInput,
          },
          {
            type: "approval_required",
            tool: "publish-release",
            input: approvedInput,
            approvalKey,
            toolCallId: "call-1",
          },
          {
            type: "tool_done",
            id: "call-1",
            tool: "publish-release",
            result: "Awaiting human approval. This action did NOT execute.",
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text", text: "Release published." },
          { type: "done" },
        ]),
      );
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-approval",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession({
      id: "thread-approval",
      threadId: "thread-approval",
    });
    const first = await session.startTurn({ prompt: "Publish it" });
    const firstEvents = await drain(first.events);

    const continuation = await session.continueTurn?.({
      turnId: first.id,
      approval: {
        id: approvalKey,
        approved: true,
      },
    });
    expect(continuation).toBeDefined();
    const events = await drain(continuation!.events);

    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      message: "Approved. Go ahead and run the requested action.",
      threadId: "thread-approval",
      turnId: first.id,
      internalContinuation: true,
      approvedToolCalls: [approvalKey],
      structuredHistory: expect.arrayContaining([
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-0",
              content: "Release lookup failed.",
              isError: true,
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              id: "call-1",
              name: "publish-release",
              input: approvedInput,
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              content: "Awaiting human approval. This action did NOT execute.",
            },
          ],
        },
      ]),
    });
    const continuationBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body),
    );
    expect(continuationBody.structuredHistory.slice(-6)).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Waiting for approval. " }],
      },
      {
        role: "assistant",
        content: [
          { type: "tool-call", id: "call-0", name: "read-release", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-0",
            content: "Release lookup failed.",
            isError: true,
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Release lookup failed; requesting approval. ",
          },
        ],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "call-1",
            name: "publish-release",
            input: approvedInput,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            content: "Awaiting human approval. This action did NOT execute.",
          },
        ],
      },
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "done",
      reason: "complete",
    });
    const initialMessage = firstEvents.find(
      (event) => event.type === "message-start",
    );
    expect(initialMessage).toMatchObject({
      type: "message-start",
      message: { id: expect.any(String) },
    });
    expect(events.some((event) => event.type === "message-start")).toBe(false);
    expect(events.find((event) => event.type === "message-done")).toMatchObject(
      {
        message: {
          id:
            initialMessage?.type === "message-start"
              ? initialMessage.message.id
              : undefined,
          content: [
            { type: "text", text: "Waiting for approval. " },
            {
              type: "text",
              text: "Release lookup failed; requesting approval. ",
            },
            { type: "text", text: "Release published." },
          ],
        },
      },
    );
  });

  it("keeps the pending approval pair ahead of oversized continuation history", async () => {
    const approvalInput = {
      release: "agentkit-acceptance",
      environment: "production",
    };
    const approvalKey =
      'accept-agentkit-release:{"environment":"production","release":"agentkit-acceptance"}';
    const approvalResult =
      "Awaiting human approval. This action did NOT execute.";
    const trailingText = "x".repeat(256 * 1024 - 300);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text", text: "Waiting for approval." },
          {
            type: "tool_start",
            id: "call-approved-release",
            tool: "accept-agentkit-release",
            input: approvalInput,
          },
          {
            type: "approval_required",
            tool: "accept-agentkit-release",
            input: approvalInput,
            approvalKey,
            toolCallId: "call-approved-release",
          },
          {
            type: "tool_done",
            id: "call-approved-release",
            tool: "accept-agentkit-release",
            result: approvalResult,
          },
          { type: "text", text: trailingText },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-prioritized-approval-history",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession({
      id: "thread-prioritized-approval-history",
      threadId: "thread-prioritized-approval-history",
    });
    const first = await session.startTurn({ prompt: "Accept the release" });
    await drain(first.events);

    const continuation = await session.continueTurn?.({
      turnId: first.id,
      approval: { id: approvalKey, approved: true },
    });
    expect(continuation).toBeDefined();
    await drain(continuation!.events);

    const request = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const structuredHistory = request.structuredHistory as Array<{
      content: Array<{
        type: string;
        id?: string;
        name?: string;
        toolCallId?: string;
        content?: string;
      }>;
    }>;
    const parts = structuredHistory.flatMap((message) => message.content);
    const toolResultIds = parts
      .filter((part) => part.type === "tool-result")
      .map((part) => part.toolCallId);

    expect(request).toMatchObject({
      message: "Approved. Go ahead and run the requested action.",
      approvedToolCalls: [approvalKey],
    });
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-call",
        id: "call-approved-release",
        name: "accept-agentkit-release",
      }),
    );
    expect(toolResultIds).toContain("call-approved-release");
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-approved-release",
        content: approvalResult,
      }),
    );
    expect(parts).not.toContainEqual({ type: "text", text: trailingText });
  });

  it("bounds supplemental approval history and omits oversized metadata", async () => {
    const oversizedToolCallId = "i".repeat(64 * 1024 + 1);
    const oversizedToolName = "n".repeat(64 * 1024 + 1);
    const approvalKey = `${oversizedToolName}:{}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          { type: "text", text: "x".repeat(280 * 1024) },
          {
            type: "tool_start",
            id: oversizedToolCallId,
            tool: oversizedToolName,
            input: {},
          },
          {
            type: "approval_required",
            tool: oversizedToolName,
            input: {},
            approvalKey,
            toolCallId: oversizedToolCallId,
          },
          {
            type: "tool_done",
            id: oversizedToolCallId,
            tool: oversizedToolName,
            result: "Result omitted with oversized metadata.",
          },
          { type: "done" },
        ]),
      )
      .mockResolvedValueOnce(sseResponse([{ type: "done" }]));
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-bounded-approval-history",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession({
      id: "thread-bounded-approval-history",
      threadId: "thread-bounded-approval-history",
    });
    const first = await session.startTurn({ prompt: "Run it" });
    await drain(first.events);
    const continuation = await session.continueTurn?.({
      turnId: first.id,
      approval: { id: approvalKey, approved: true },
    });
    expect(continuation).toBeDefined();
    await drain(continuation!.events);

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const history = body.structuredHistory as Array<{
      content: Array<{
        type: string;
        id?: string;
        name?: string;
        toolCallId?: string;
        text?: string;
      }>;
    }>;
    const parts = history.flatMap((message) => message.content);
    const historyBytes = new TextEncoder().encode(
      JSON.stringify(body.structuredHistory),
    ).byteLength;

    expect(historyBytes).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.stringify(body.structuredHistory)).not.toContain(
      oversizedToolCallId,
    );
    expect(JSON.stringify(body.structuredHistory)).not.toContain(
      oversizedToolName,
    );
    expect(parts).toContainEqual({
      type: "text",
      text: "Tool call omitted from history because its ID or name exceeds 64 KiB.",
    });
    expect(parts).toContainEqual({
      type: "text",
      text: "Tool result omitted from history because its ID or name exceeds 64 KiB.",
    });
    expect(parts.some((part) => part.type === "tool-call")).toBe(false);
    expect(parts.some((part) => part.type === "tool-result")).toBe(false);
    expect(parts).toContainEqual({
      type: "text",
      text: "Some history was omitted to keep structured history within 256 KiB and 64 tool entries.",
    });
  });

  it("resolves a denied approval without starting another agent run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "approval_required",
          tool: "publish-release",
          approvalKey: "publish-release:{}",
        },
        { type: "done" },
      ]),
    );
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "/_agent-native/agent-chat",
      threadId: "thread-denial",
      fetch: fetchMock as typeof fetch,
    });
    const session = await runtime.createSession({ id: "thread-denial" });
    const first = await session.startTurn({ prompt: "Publish it" });
    await drain(first.events);

    const continuation = await session.continueTurn?.({
      turnId: first.id,
      approval: {
        id: "publish-release:{}",
        approved: false,
      },
    });
    expect(continuation).toBeDefined();
    expect(await drain(continuation!.events)).toEqual([
      { type: "done", reason: "complete" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
