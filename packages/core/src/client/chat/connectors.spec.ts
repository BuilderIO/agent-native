import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createAgUiChatRuntime,
  createClaudeAgentChatRuntime,
  createOpenAIAgentsChatRuntime,
  createOpenAIResponsesChatRuntime,
  createVercelAiChatRuntime,
  type CreateAgUiChatRuntimeOptions,
  type CreateClaudeAgentChatRuntimeOptions,
  type CreateOpenAIAgentsChatRuntimeOptions,
  type CreateOpenAIResponsesChatRuntimeOptions,
  type CreateVercelAiChatRuntimeOptions,
} from "./connectors.js";
import type {
  AgentChatRuntime,
  AgentChatRuntimeEvent,
  AgentChatRuntimeKnownEvent,
} from "./runtime.js";

function sseResponse(events: unknown[], runId = "run-connector"): Response {
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

describe("standard agent chat runtime connectors", () => {
  it("exports typed runtime factories", () => {
    expectTypeOf(createOpenAIResponsesChatRuntime).parameters.toEqualTypeOf<
      [CreateOpenAIResponsesChatRuntimeOptions]
    >();
    expectTypeOf(createOpenAIAgentsChatRuntime).parameters.toEqualTypeOf<
      [CreateOpenAIAgentsChatRuntimeOptions]
    >();
    expectTypeOf(createAgUiChatRuntime).parameters.toEqualTypeOf<
      [CreateAgUiChatRuntimeOptions]
    >();
    expectTypeOf(createClaudeAgentChatRuntime).parameters.toEqualTypeOf<
      [CreateClaudeAgentChatRuntimeOptions]
    >();
    expectTypeOf(createVercelAiChatRuntime).parameters.toEqualTypeOf<
      [CreateVercelAiChatRuntimeOptions]
    >();

    expectTypeOf(createOpenAIResponsesChatRuntime).returns.toEqualTypeOf<
      AgentChatRuntime<AgentChatRuntimeKnownEvent>
    >();
  });

  it("maps OpenAI Responses streaming events into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "response.output_text.delta",
          item_id: "message-1",
          delta: "There are ",
        },
        {
          type: "response.output_text.delta",
          item_id: "message-1",
          delta: "34 submissions.",
        },
        {
          type: "response.output_item.added",
          item: {
            type: "function_call",
            call_id: "tool-1",
            name: "query_form_submissions",
          },
        },
        {
          type: "response.function_call_arguments.delta",
          call_id: "tool-1",
          name: "query_form_submissions",
          delta: '{"formId":',
        },
        {
          type: "response.function_call_arguments.delta",
          call_id: "tool-1",
          delta: '"hackathon"}',
        },
        {
          type: "response.function_call_arguments.done",
          call_id: "tool-1",
          name: "query_form_submissions",
          arguments: '{"formId":"hackathon"}',
        },
        { type: "response.output_text.done", item_id: "message-1" },
        { type: "response.completed" },
      ]),
    );
    const runtime = createOpenAIResponsesChatRuntime({
      endpoint: "/openai/responses",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-1" })
    ).startTurn({
      prompt: "How many submissions?",
    });
    const events = await drain(turn.events);

    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "message-delta",
      "tool-start",
      "tool-delta",
      "tool-delta",
      "tool-done",
      "message-done",
      "done",
    ]);
    expect(
      (events[1] as Extract<AgentChatRuntimeEvent, { type: "message-delta" }>)
        .delta,
    ).toEqual({ type: "text", text: "There are " });
    expect(events[3]).toMatchObject({
      type: "tool-start",
      toolCall: { id: "tool-1", name: "query_form_submissions" },
    });
    expect(events[6]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: '{"formId":"hackathon"}',
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      prompt: "How many submissions?",
      sessionId: "thread-1",
    });
  });

  it("maps OpenAI Agents SDK streams into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "raw_model_stream_event",
          data: {
            type: "response.output_text.delta",
            item_id: "message-1",
            delta: "Looking up forms.",
          },
        },
        {
          type: "run_item_stream_event",
          name: "tool_called",
          item: {
            call_id: "tool-1",
            name: "lookup_forms",
            arguments: { q: "forms" },
          },
        },
        {
          type: "run_item_stream_event",
          name: "tool_output",
          item: {
            call_id: "tool-1",
            name: "lookup_forms",
            output: "34 rows",
          },
        },
        {
          type: "run_item_stream_event",
          name: "handoff_occured",
          item: { name: "analytics" },
        },
        {
          type: "raw_model_stream_event",
          data: { type: "response.completed" },
        },
      ]),
    );
    const runtime = createOpenAIAgentsChatRuntime({
      endpoint: "/openai/agents",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-1" })
    ).startTurn({
      prompt: "Inspect the form",
    });
    const events = await drain(turn.events);

    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "tool-start",
      "tool-done",
      "status",
      "message-done",
      "done",
    ]);
    expect(events[2]).toMatchObject({
      type: "tool-start",
      toolCall: {
        id: "tool-1",
        name: "lookup_forms",
        input: { q: "forms" },
      },
    });
    expect(events[3]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: "34 rows",
    });
    expect(events[4]).toMatchObject({
      type: "status",
      message: "Agent handoff completed",
    });
  });

  it("maps AG-UI streams into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "RUN_STARTED" },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "message-1",
          role: "assistant",
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "message-1",
          delta: "Charting submissions.",
        },
        {
          type: "TOOL_CALL_ARGS",
          toolCallId: "tool-1",
          toolCallName: "query_submissions",
          delta: '{"groupBy":"day"}',
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallId: "tool-1",
          toolCallName: "query_submissions",
          content: "7 buckets",
        },
        { type: "TEXT_MESSAGE_END", messageId: "message-1" },
        { type: "RUN_FINISHED" },
      ]),
    );
    const runtime = createAgUiChatRuntime({
      endpoint: "/ag-ui",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-1" })
    ).startTurn({
      prompt: "Chart submissions by day",
    });
    const events = await drain(turn.events);

    expect(events.map((event) => event.type)).toEqual([
      "status",
      "message-start",
      "message-delta",
      "tool-start",
      "tool-delta",
      "tool-done",
      "message-done",
      "done",
    ]);
    expect(events[3]).toMatchObject({
      type: "tool-start",
      toolCall: { id: "tool-1", name: "query_submissions" },
    });
    expect(events[4]).toMatchObject({
      type: "tool-delta",
      inputTextDelta: '{"groupBy":"day"}',
    });
    expect(events[5]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: "7 buckets",
    });
  });

  it("maps Vercel AI SDK UI message streams into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "start", messageId: "message-1" },
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: "Checking " },
        { type: "text-delta", id: "text-1", delta: "submissions." },
        {
          type: "tool-input-start",
          toolCallId: "tool-1",
          toolName: "querySubmissions",
        },
        {
          type: "tool-input-delta",
          toolCallId: "tool-1",
          inputTextDelta: '{"formId":"hackathon"}',
        },
        {
          type: "tool-output-available",
          toolCallId: "tool-1",
          toolName: "querySubmissions",
          output: { count: 34 },
        },
        { type: "finish", usage: { inputTokens: 4, outputTokens: 6 } },
      ]),
    );
    const runtime = createVercelAiChatRuntime({
      endpoint: "/vercel-ai",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-1" })
    ).startTurn({
      prompt: "How many submissions?",
    });
    const events = await drain(turn.events);

    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "message-delta",
      "tool-start",
      "tool-delta",
      "tool-done",
      "usage",
      "message-done",
      "done",
    ]);
    expect(events[1]).toMatchObject({
      type: "message-delta",
      messageId: "message-1",
      delta: { type: "text", text: "Checking " },
    });
    expect(events[5]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: '{"count":34}',
    });
    expect(events[6]).toMatchObject({
      type: "usage",
      usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
    });
  });

  it("maps Claude agent content block streams into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        {
          type: "message_start",
          message: {
            id: "message-1",
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Checking project docs." },
        },
        {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "read_file",
            input: { path: "README.md" },
          },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: {
            type: "input_json_delta",
            partial_json: '{"path":"README.md"}',
          },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_stop" },
        {
          type: "result",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
          total_cost_usd: 0.025,
        },
      ]),
    );
    const runtime = createClaudeAgentChatRuntime({
      endpoint: "/claude/agent",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-1" })
    ).startTurn({
      prompt: "Inspect the docs",
    });
    const events = await drain(turn.events);

    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "tool-start",
      "tool-delta",
      "tool-done",
      "message-done",
      "usage",
      "done",
    ]);
    expect(events[1]).toMatchObject({
      type: "message-delta",
      messageId: "message-1",
      delta: { type: "text", text: "Checking project docs." },
    });
    expect(events[2]).toMatchObject({
      type: "tool-start",
      toolCall: {
        id: "tool-1",
        name: "read_file",
        input: { path: "README.md" },
      },
    });
    expect(events[4]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: '{"path":"README.md"}',
    });
    expect(events[6]).toMatchObject({
      type: "usage",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costCents: 2.5,
      },
    });
  });

  it("maps Vercel AI SDK streams into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "start", messageId: "message-1" },
        {
          type: "text-delta",
          messageId: "message-1",
          delta: "Reading the docs.",
        },
        {
          type: "tool-input-start",
          toolCallId: "tool-1",
          toolName: "lookup_docs",
        },
        {
          type: "tool-input-delta",
          toolCallId: "tool-1",
          inputTextDelta: '{"topic":"chat"}',
        },
        {
          type: "tool-output-available",
          toolCallId: "tool-1",
          toolName: "lookup_docs",
          output: "Found chat docs",
        },
        {
          type: "finish",
          usage: {
            inputTokens: 12,
            outputTokens: 8,
          },
          total_cost_usd: 0.01,
        },
      ]),
    );
    const runtime = createVercelAiChatRuntime({
      endpoint: "/vercel/ai",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-1" })
    ).startTurn({
      prompt: "Read the chat docs",
    });
    const events = await drain(turn.events);

    expect(events.map((event) => event.type)).toEqual([
      "message-start",
      "message-delta",
      "tool-start",
      "tool-delta",
      "tool-done",
      "usage",
      "message-done",
      "done",
    ]);
    expect(events[1]).toMatchObject({
      type: "message-delta",
      messageId: "message-1",
      delta: { type: "text", text: "Reading the docs." },
    });
    expect(events[2]).toMatchObject({
      type: "tool-start",
      toolCall: { id: "tool-1", name: "lookup_docs" },
    });
    expect(events[4]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: "Found chat docs",
    });
    expect(events[5]).toMatchObject({
      type: "usage",
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        costCents: 1,
      },
    });
  });
});
