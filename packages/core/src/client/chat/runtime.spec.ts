import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  subscribeChatFirstOpenApp,
  subscribeChatFirstOpenBrowser,
} from "../chat-first.js";
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

  it("lets a transport continue a paused turn with the previous input", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([{ type: "done" }], "run-1"))
      .mockResolvedValueOnce(sseResponse([{ type: "done" }], "run-2"));
    const runtime = createHttpAgentChatRuntime({
      endpoint: "/agent/chat",
      fetch: fetchMock as typeof fetch,
      continueTurn: ({ continuation, previousTurn, startTurn }) =>
        startTurn({
          ...previousTurn,
          prompt: continuation.prompt,
        }),
    });
    const session = await runtime.createSession({ id: "thread-1" });
    const first = await session.startTurn({ prompt: "Start" });
    await drain(first.events);

    const second = await session.continueTurn?.({ prompt: "Continue" });
    expect(second).toBeDefined();
    await drain(second!.events);

    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).toMatchObject({
      prompt: "Continue",
    });
  });
});

describe("createAgentNativeChatRuntime", () => {
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
    expect(streamRequest?.credentials).toBe("omit");
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
            { type: "text", text: "Release published." },
          ],
        },
      },
    );
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
