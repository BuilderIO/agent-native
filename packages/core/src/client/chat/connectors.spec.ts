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
          type: "response.reasoning_summary_text.delta",
          item_id: "reasoning-1",
          summary_index: 0,
          delta: "I should inspect ",
        },
        {
          type: "response.reasoning_summary_text.delta",
          item_id: "reasoning-1",
          summary_index: 0,
          delta: "the submission data.",
        },
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
      "message-start",
      "message-delta",
      "message-delta",
      "tool-start",
      "tool-delta",
      "tool-delta",
      "tool-done",
      "message-done",
      "message-done",
      "done",
    ]);
    expect(
      (events[1] as Extract<AgentChatRuntimeEvent, { type: "message-delta" }>)
        .delta,
    ).toEqual({
      type: "reasoning",
      text: "I should inspect ",
      partId: "reasoning-1:summary:0",
    });
    expect(events[6]).toMatchObject({
      type: "tool-start",
      toolCall: { id: "tool-1", name: "query_form_submissions" },
    });
    expect(events[9]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: '{"formId":"hackathon"}',
    });
    expect(events.at(-2)).toMatchObject({
      type: "message-done",
      message: {
        id: "reasoning-1",
        content: [
          {
            type: "reasoning",
            id: "reasoning-1:summary:0",
            text: "I should inspect the submission data.",
          },
        ],
      },
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
            type: "response.reasoning_summary_text.delta",
            item_id: "reasoning-1",
            summary_index: 0,
            delta: "I should inspect the forms first.",
          },
        },
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
      "message-start",
      "message-delta",
      "tool-start",
      "tool-done",
      "status",
      "message-done",
      "message-done",
      "done",
    ]);
    expect(events[4]).toMatchObject({
      type: "tool-start",
      toolCall: {
        id: "tool-1",
        name: "lookup_forms",
        input: { q: "forms" },
      },
    });
    expect(events[5]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: "34 rows",
    });
    expect(events[6]).toMatchObject({
      type: "status",
      message: "Agent handoff completed",
    });
    expect(events[1]).toMatchObject({
      type: "message-delta",
      delta: {
        type: "reasoning",
        text: "I should inspect the forms first.",
        partId: "reasoning-1:summary:0",
      },
    });
  });

  it("maps AG-UI streams into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "RUN_STARTED" },
        {
          type: "REASONING_MESSAGE_START",
          messageId: "reasoning-1",
          role: "reasoning",
        },
        {
          type: "REASONING_MESSAGE_CONTENT",
          messageId: "reasoning-1",
          delta: "I should chart ",
        },
        {
          type: "REASONING_MESSAGE_CONTENT",
          messageId: "reasoning-1",
          delta: "the submissions.",
        },
        { type: "REASONING_MESSAGE_END", messageId: "reasoning-1" },
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
      "message-delta",
      "message-done",
      "message-start",
      "message-delta",
      "tool-start",
      "tool-delta",
      "tool-done",
      "message-done",
      "done",
    ]);
    expect(events[2]).toMatchObject({
      type: "message-delta",
      messageId: "reasoning-1",
      delta: {
        type: "reasoning",
        text: "I should chart ",
        partId: "reasoning-1",
      },
    });
    expect(events[4]).toMatchObject({
      type: "message-done",
      message: {
        id: "reasoning-1",
        content: [
          {
            type: "reasoning",
            id: "reasoning-1",
            text: "I should chart the submissions.",
          },
        ],
      },
    });
    expect(events[7]).toMatchObject({
      type: "tool-start",
      toolCall: { id: "tool-1", name: "query_submissions" },
    });
    expect(events[8]).toMatchObject({
      type: "tool-delta",
      inputTextDelta: '{"groupBy":"day"}',
    });
    expect(events[9]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: "7 buckets",
    });
  });

  it("maps Vercel AI SDK UI message streams into chat runtime events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "start", messageId: "message-1" },
        { type: "reasoning-start", id: "reasoning-1" },
        {
          type: "reasoning-delta",
          id: "reasoning-1",
          delta: "I should check ",
        },
        {
          type: "reasoning-delta",
          id: "reasoning-1",
          delta: "the submission count.",
        },
        { type: "reasoning-end", id: "reasoning-1" },
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
      delta: {
        type: "reasoning",
        text: "I should check ",
        partId: "reasoning-1",
      },
    });
    expect(events[3]).toMatchObject({
      type: "message-delta",
      messageId: "message-1",
      delta: { type: "text", text: "Checking ", partId: "text-1" },
    });
    expect(events[7]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: '{"count":34}',
    });
    expect(events[8]).toMatchObject({
      type: "usage",
      usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
    });
    expect(events[9]).toMatchObject({
      type: "message-done",
      message: {
        id: "message-1",
        content: [
          {
            type: "reasoning",
            id: "reasoning-1",
            text: "I should check the submission count.",
          },
          { type: "text", id: "text-1", text: "Checking submissions." },
        ],
      },
    });
  });

  it("preserves whitespace-only Vercel reasoning and text deltas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "start", messageId: "message-whitespace" },
        { type: "reasoning-start", id: "reasoning-whitespace" },
        {
          type: "reasoning-delta",
          id: "reasoning-whitespace",
          delta: "First",
        },
        {
          type: "reasoning-delta",
          id: "reasoning-whitespace",
          delta: "\n  ",
        },
        {
          type: "reasoning-delta",
          id: "reasoning-whitespace",
          delta: "second",
        },
        { type: "reasoning-end", id: "reasoning-whitespace" },
        { type: "text-start", id: "text-whitespace" },
        { type: "text-delta", id: "text-whitespace", delta: "Answer" },
        { type: "text-delta", id: "text-whitespace", delta: " \n" },
        { type: "text-delta", id: "text-whitespace", delta: "done" },
        { type: "text-end", id: "text-whitespace" },
        { type: "finish" },
      ]),
    );
    const runtime = createVercelAiChatRuntime({
      endpoint: "/vercel-ai/whitespace",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-whitespace" })
    ).startTurn({ prompt: "Preserve whitespace" });
    const events = await drain(turn.events);
    const deltas = events
      .filter(
        (
          event,
        ): event is Extract<AgentChatRuntimeEvent, { type: "message-delta" }> =>
          event.type === "message-delta",
      )
      .map((event) => event.delta);

    expect(deltas).toEqual([
      {
        type: "reasoning",
        text: "First",
        partId: "reasoning-whitespace",
      },
      {
        type: "reasoning",
        text: "\n  ",
        partId: "reasoning-whitespace",
      },
      {
        type: "reasoning",
        text: "second",
        partId: "reasoning-whitespace",
      },
      { type: "text", text: "Answer", partId: "text-whitespace" },
      { type: "text", text: " \n", partId: "text-whitespace" },
      { type: "text", text: "done", partId: "text-whitespace" },
    ]);
    expect(events.at(-2)).toMatchObject({
      type: "message-done",
      message: {
        content: [
          { type: "reasoning", text: "First\n  second" },
          { type: "text", text: "Answer \ndone" },
        ],
      },
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
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "thinking_delta",
            thinking: "I should read ",
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "thinking_delta",
            thinking: "the project docs.",
          },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "signature_delta", signature: "sig-claude" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Checking project docs." },
        },
        {
          type: "content_block_start",
          index: 2,
          content_block: {
            type: "tool_use",
            id: "tool-1",
            name: "read_file",
            input: { path: "README.md" },
          },
        },
        {
          type: "content_block_delta",
          index: 2,
          delta: {
            type: "input_json_delta",
            partial_json: '{"path":"README.md"}',
          },
        },
        { type: "content_block_stop", index: 2 },
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
      "message-delta",
      "message-delta",
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
      delta: {
        type: "reasoning",
        text: "I should read ",
        partId: "message-1:content:0",
      },
    });
    expect(events[3]).toMatchObject({
      type: "message-delta",
      messageId: "message-1",
      delta: {
        type: "reasoning",
        text: "",
        partId: "message-1:content:0",
        signature: "sig-claude",
      },
    });
    expect(events[4]).toMatchObject({
      type: "message-delta",
      messageId: "message-1",
      delta: {
        type: "text",
        text: "Checking project docs.",
        partId: "message-1:content:1",
      },
    });
    expect(events[5]).toMatchObject({
      type: "tool-start",
      toolCall: {
        id: "tool-1",
        name: "read_file",
        input: { path: "README.md" },
      },
    });
    expect(events[7]).toMatchObject({
      type: "tool-done",
      toolCallId: "tool-1",
      resultText: '{"path":"README.md"}',
    });
    expect(events[9]).toMatchObject({
      type: "usage",
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        costCents: 2.5,
      },
    });
    expect(events[8]).toMatchObject({
      type: "message-done",
      message: {
        id: "message-1",
        content: [
          {
            type: "reasoning",
            id: "message-1:content:0",
            text: "I should read the project docs.",
            signature: "sig-claude",
          },
          {
            type: "text",
            id: "message-1:content:1",
            text: "Checking project docs.",
          },
        ],
      },
    });
  });

  it("preserves whitespace-only Claude thinking and text deltas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "message_start", message: { id: "message-whitespace" } },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "First" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "\n  " },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "second" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Answer" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: " \n" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "done" },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_stop" },
        { type: "result" },
      ]),
    );
    const runtime = createClaudeAgentChatRuntime({
      endpoint: "/claude/agent/whitespace",
      fetch: fetchMock as typeof fetch,
    });

    const turn = await (
      await runtime.createSession({ id: "thread-whitespace" })
    ).startTurn({ prompt: "Preserve whitespace" });
    const events = await drain(turn.events);
    const deltas = events
      .filter(
        (
          event,
        ): event is Extract<AgentChatRuntimeEvent, { type: "message-delta" }> =>
          event.type === "message-delta",
      )
      .map((event) => event.delta);

    expect(deltas).toEqual([
      {
        type: "reasoning",
        text: "First",
        partId: "message-whitespace:content:0",
      },
      {
        type: "reasoning",
        text: "\n  ",
        partId: "message-whitespace:content:0",
      },
      {
        type: "reasoning",
        text: "second",
        partId: "message-whitespace:content:0",
      },
      {
        type: "text",
        text: "Answer",
        partId: "message-whitespace:content:1",
      },
      {
        type: "text",
        text: " \n",
        partId: "message-whitespace:content:1",
      },
      {
        type: "text",
        text: "done",
        partId: "message-whitespace:content:1",
      },
    ]);
    expect(events.at(-2)).toMatchObject({
      type: "message-done",
      message: {
        content: [
          { type: "reasoning", text: "First\n  second" },
          { type: "text", text: "Answer \ndone" },
        ],
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
