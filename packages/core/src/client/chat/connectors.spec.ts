import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createAgUiChatRuntime,
  createOpenAIAgentsChatRuntime,
  createOpenAIResponsesChatRuntime,
  type CreateAgUiChatRuntimeOptions,
  type CreateOpenAIAgentsChatRuntimeOptions,
  type CreateOpenAIResponsesChatRuntimeOptions,
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
});
