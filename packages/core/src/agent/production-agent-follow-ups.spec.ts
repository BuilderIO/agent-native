import { describe, expect, it, vi } from "vitest";

import { AgentKitClient } from "../../../agentkit/src/client/client.js";
import { selectAgentSuggestions } from "../../../agentkit/src/client/state.js";
import type { AgentThreadSnapshot } from "../../../agentkit/src/protocol/index.js";
import { createAgentKitProtocolAdapter } from "../client/chat/agentkit-protocol.js";
import { createAgentNativeChatRuntime } from "../client/chat/runtime.js";
import * as contextTransforms from "./engine/context-directives-transform.js";
import * as journal from "./engine/tool-call-journal-seed.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineStreamOptions,
} from "./engine/types.js";
import {
  FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION,
  FOLLOW_UP_SUGGESTIONS_INSTRUCTION,
  FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
} from "./follow-up-suggestions.js";
import { TripWire } from "./processors.js";
import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
} from "./production-agent.js";
import * as runStore from "./run-store.js";
import {
  buildAssistantMessage,
  foldAssistantTurn,
  normalizeThreadRepository,
  threadDataToEngineMessages,
} from "./thread-data-builder.js";
import type { AgentChatEvent } from "./types.js";

vi.mock("../server/action-change.js", () => ({
  actionCallIsReadOnly: () => true,
  notifyActionChangeInBackground: vi.fn(),
}));

const followUp = {
  label: "Refine the layout",
  prompt: "Refine the spacing of the design we just created.",
};
const call = (
  input: unknown = { suggestions: [followUp] },
  id = "follow-up-1",
): EngineContentPart => ({
  type: "tool-call",
  id,
  name: FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
  input,
});
const reply = (text = "Created your design."): EngineContentPart => ({
  type: "text",
  text,
});
function step(
  parts: EngineContentPart[],
  reason: Extract<EngineEvent, { type: "stop" }>["reason"] = "end_turn",
): EngineEvent[] {
  return [
    { type: "assistant-content", parts },
    { type: "stop", reason },
  ];
}

function setup(
  steps: EngineEvent[][],
  actions: Record<string, ActionEntry> = {},
) {
  const events: AgentChatEvent[] = [];
  const requests: EngineStreamOptions[] = [];
  const controller = new AbortController();
  const engine: AgentEngine = {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: true,
    },
    async *stream(opts) {
      const index = requests.length;
      requests.push({ ...opts, messages: structuredClone(opts.messages) });
      if (!steps[index]) throw new Error("Unexpected model request");
      yield* steps[index];
    },
  };
  const opts: Parameters<typeof runAgentLoop>[0] = {
    engine,
    model: "test-model",
    systemPrompt: "Design app workflow instructions.",
    tools: actionsToEngineTools(actions),
    actions,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Create a design. <current-screen>canvas</current-screen>",
          },
        ],
      },
    ],
    send: (event) => events.push(event),
    signal: controller.signal,
    runId: "canonical-run",
    followUpSuggestions: true,
    maxIterations: 5,
    maxOutputTokens: 1024,
    reasoningEffort: "low",
  };
  return { events, requests, controller, opts };
}

function published(events: AgentChatEvent[]) {
  return events.filter(
    (event) => event.type === "suggestions" && event.suggestions.length > 0,
  );
}

const read: ActionEntry = {
  tool: {
    description: "Read current artifact",
    parameters: { type: "object", properties: {} },
  },
  readOnly: true,
  run: async () => ({ title: "New design", status: "saved" }),
};
const readCall: EngineContentPart = {
  type: "tool-call",
  id: "read-1",
  name: "read-artifact",
  input: {},
};

describe("native agent follow-up publication", () => {
  it.each(["success", "failure", "cancel"])(
    "includes the completion reminder in context processing (%s)",
    async (mode) => {
      const { opts, requests, events, controller } = setup([
        step([reply()]),
        step([call()], "tool_use"),
      ]);
      opts.threadId = "thread-fixture";
      const transform = vi
        .spyOn(contextTransforms, "applyContextXrayTransformForIteration")
        .mockImplementation(async ({ messages }) => {
          if (
            messages
              .at(-1)
              ?.content.some(
                (part) =>
                  part.type === "text" &&
                  part.text === FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION,
              )
          ) {
            if (mode === "failure") throw new Error("Context unavailable");
            if (mode === "cancel") controller.abort();
          }
          return messages;
        });
      const readJournal = vi
        .spyOn(journal, "loadPriorTurnToolCallJournal")
        .mockResolvedValue({
          status: "read",
          toolCallJournal: null,
          priorToolCalls: [],
          priorToolCallSequence: [],
          priorToolResults: [],
        });
      const clearLedger = vi
        .spyOn(runStore, "clearLedgerForThread")
        .mockResolvedValue();
      try {
        await runAgentLoop(opts);
        expect(transform).toHaveBeenCalledTimes(2);
        expect(transform.mock.calls[1][0].messages.at(-1)).toEqual({
          role: "user",
          content: [
            {
              type: "text",
              text: FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION,
            },
          ],
        });
        expect(requests).toHaveLength(mode === "success" ? 2 : 1);
        if (mode === "failure")
          expect(events.at(-2)).toMatchObject({
            type: "rich_event",
            event: { data: { code: "context_error" } },
          });
        if (mode === "cancel")
          expect(events.some((event) => event.type === "done")).toBe(false);
      } finally {
        transform.mockRestore();
        readJournal.mockRestore();
        clearLedger.mockRestore();
      }
    },
  );

  it.each([undefined, 512, 128, 32_768])(
    "respects the metadata cap and supported output floor for %s",
    async (budget) => {
      const { opts, requests } = setup([
        step([reply()]),
        step([call({ suggestions: [] })], "tool_use"),
      ]);
      opts.maxOutputTokens = budget;
      await runAgentLoop(opts);
      expect(requests[1].maxOutputTokens).toBe(
        Math.max(256, Math.min(budget ?? 1024, 1024)),
      );
    },
  );

  it("replenishes model-authored chips after using a chip when the next reply omits metadata", async () => {
    const next = {
      label: "Review mobile",
      prompt: "Review this refined design at mobile sizes.",
    };
    const turns = [
      setup([step([reply(), call()])]),
      setup([
        step([reply("Refined the layout.")]),
        step([call({ suggestions: [next] })], "tool_use"),
      ]),
    ];
    const requests: { message: string; history: unknown[] }[] = [];
    const runtime = createAgentNativeChatRuntime({
      apiUrl: "https://example.test/agent-chat",
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        const turn = turns[requests.length - 1];
        turn.opts.runId = `canonical-${requests.length}`;
        turn.opts.messages = [
          ...body.history.map(
            (message: { role: "user" | "assistant"; content: string }) => ({
              role: message.role,
              content: [{ type: "text" as const, text: message.content }],
            }),
          ),
          { role: "user", content: [{ type: "text", text: body.message }] },
        ];
        await runAgentLoop(turn.opts);
        return new Response(
          turn.events
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "X-Run-Id": turn.opts.runId,
            },
          },
        );
      },
    });
    let snapshot: AgentThreadSnapshot = {
      id: "thread-1",
      createdAt: "2026-09-28T12:00:00Z",
      updatedAt: "2026-09-28T12:00:00Z",
      messages: [],
    };
    const transport = createAgentKitProtocolAdapter(runtime);
    transport.getThreadSnapshot = async () => snapshot;
    transport.persistThreadSnapshot = async (input) => {
      snapshot = structuredClone(input.snapshot);
    };
    const client = new AgentKitClient({ transport });
    const cold = new AgentKitClient({ transport });
    try {
      await client.loadThread("thread-1");
      await (
        await client.sendMessage({
          threadId: "thread-1",
          text: "Create a design",
        })
      ).completed;
      const first = selectAgentSuggestions(client.getThread("thread-1"));
      expect(first).toHaveLength(1);
      const secondRun = await client.sendMessage({
        threadId: "thread-1",
        text: first[0].prompt!,
      });
      await secondRun.completed;
      const secondThread = client.getThread("thread-1");
      const second = selectAgentSuggestions(secondThread);
      expect(requests[1].message).toBe(followUp.prompt);
      expect(second).toEqual([
        expect.objectContaining({ ...next, runId: secondRun.runId }),
      ]);
      expect(second[0].id).not.toBe(first[0].id);
      expect(secondThread.suggestionsUserMessageId).toBe(
        secondThread.messages.findLast((message) => message.role === "user")
          ?.id,
      );
      expect(turns.map((turn) => turn.requests.length)).toEqual([1, 2]);
      expect(turns[1].requests[1].messages).toEqual(
        expect.arrayContaining([
          { role: "user", content: [{ type: "text", text: followUp.prompt }] },
          { role: "assistant", content: [reply("Refined the layout.")] },
        ]),
      );
      await cold.loadThread("thread-1");
      expect(selectAgentSuggestions(cold.getThread("thread-1"))).toEqual(
        second,
      );
    } finally {
      client.dispose();
      cold.dispose();
    }
  });

  it("completes missing metadata once with bounded output, no reasoning, and full usage accounting", async () => {
    const { opts, events, requests } = setup([
      [
        ...step([reply()]),
        { type: "usage", inputTokens: 100, outputTokens: 30 },
      ],
      [
        { type: "thinking-delta", text: "Private metadata deliberation" },
        { type: "text-delta", text: "Do not replay this answer" },
        ...step([call()], "tool_use"),
        {
          type: "usage",
          inputTokens: 200,
          outputTokens: 40,
          cacheReadTokens: 80,
          builderCreditsUsed: 1,
        },
      ],
    ]);
    opts.maxOutputTokens = 32_768;
    opts.reasoningEffort = "high";
    opts.providerOptions = {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: 8_000 },
        cacheControl: false,
        topK: 20,
      },
      openai: { store: false },
    };
    opts.onUsage = vi.fn();
    const processor = {
      processOutputStream: vi.fn(),
      processOutputStep: vi.fn(),
      processOutputResult: vi.fn(),
    };
    opts.processors = [processor];
    const usage = await runAgentLoop(opts);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      maxOutputTokens: 1024,
      reasoningEffort: "none",
      providerOptions: {
        anthropic: { cacheControl: false, topK: 20 },
        openai: { store: false },
      },
    });
    expect(requests[1].providerOptions?.anthropic).not.toHaveProperty(
      "thinking",
    );
    expect(opts.providerOptions.anthropic?.thinking).toBeDefined();
    expect(requests[1].tools.map((tool) => tool.name)).toEqual([
      FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
    ]);
    expect(requests[1].messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: FOLLOW_UP_SUGGESTIONS_COMPLETION_INSTRUCTION },
      ],
    });
    expect(usage).toMatchObject({
      llmCalls: 2,
      inputTokens: 300,
      outputTokens: 70,
      cacheReadTokens: 80,
      builderCreditsUsed: 1,
    });
    expect(opts.onUsage).toHaveBeenCalledTimes(2);
    expect(processor.processOutputStep).toHaveBeenCalledTimes(2);
    expect(processor.processOutputResult).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Created your design." }),
    );
    expect(
      events.filter(
        (event) => event.type === "text" || event.type === "thinking",
      ),
    ).toEqual([{ type: "text", text: "Created your design." }]);
    expect(published(events)).toHaveLength(1);
    expect(opts.messages).toHaveLength(2);
  });

  it.each([
    [
      "omitted",
      step([reply("Unwanted repeated answer")]),
      "invalid_or_missing",
    ],
    [
      "invalid",
      step([call({ suggestions: [{ label: "Broken" }] })], "tool_use"),
      "invalid_or_missing",
    ],
    ["app action", step([readCall, call()], "tool_use"), "invalid_or_missing"],
    ["truncated", step([call()], "max_tokens"), "invalid_or_missing"],
    ["interrupted", [], "interrupted"],
    [
      "provider error",
      [
        {
          type: "stop",
          reason: "error",
          error: "Unavailable",
          statusCode: 503,
        },
      ],
      "provider_error",
    ],
  ] as const)(
    "retains the reply and reports bounded %s metadata failure",
    async (_kind, recovery, code) => {
      const run = vi.fn(read.run);
      const { opts, events, requests } = setup(
        [step([reply()]), [...recovery] as EngineEvent[]],
        { "read-artifact": { ...read, run } },
      );
      await runAgentLoop(opts);
      expect(requests).toHaveLength(2);
      expect(run).not.toHaveBeenCalled();
      expect(events.filter((event) => event.type === "suggestions")).toEqual([
        { type: "suggestions", suggestions: [] },
      ]);
      expect(events.filter((event) => event.type === "rich_event")).toEqual([
        {
          type: "rich_event",
          event: {
            namespace: "agent-native.follow-up-suggestions",
            name: "generation_failed",
            version: 1,
            data: { code, runId: "canonical-run" },
          },
        },
      ]);
      expect(events.filter((event) => event.type === "text")).toEqual([
        { type: "text", text: "Created your design." },
      ]);
      expect(
        events.some(
          (event) =>
            event.type === "error" ||
            event.type === "clear" ||
            event.type === "auto_continue",
        ),
      ).toBe(false);
      expect(events.at(-1)).toEqual({ type: "done" });
    },
  );

  it.each(["iteration_limit", "budget_exhausted"])(
    "does not exceed the run's %s for optional metadata",
    async (code) => {
      const { opts, events, requests } = setup([
        [
          ...step([reply()]),
          { type: "usage", inputTokens: 30_000, outputTokens: 10 },
        ],
      ]);
      if (code === "iteration_limit") opts.maxIterations = 1;
      else opts.maxRunInputTokens = 20_000;
      await runAgentLoop(opts);
      expect(requests).toHaveLength(1);
      expect(events.at(-2)).toMatchObject({
        type: "rich_event",
        event: { data: { code } },
      });
      expect(events.at(-1)).toEqual({ type: "done" });
    },
  );

  it.each(["stream", "step"])(
    "retains the final answer when the metadata %s processor rejects it",
    async (stage) => {
      const { opts, events } = setup([
        step([reply()]),
        step([call()], "tool_use"),
      ]);
      opts.processors = [
        {
          processOutputStream: ({ part }) => {
            if (
              stage === "stream" &&
              part.type === "assistant-content" &&
              part.parts.some((part) => part.type === "tool-call")
            )
              throw new TripWire("Metadata rejected");
          },
          processOutputStep: ({ toolCalls }) => {
            if (stage === "step" && toolCalls.length)
              throw new Error("Processor failed");
          },
        },
      ];
      await runAgentLoop(opts);
      expect(events.filter((event) => event.type === "rich_event")).toEqual([
        expect.objectContaining({
          event: expect.objectContaining({
            data: { code: "processor_error", runId: "canonical-run" },
          }),
        }),
      ]);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(
        events.some(
          (event) => event.type === "clear" || event.type === "error",
        ),
      ).toBe(false);
    },
  );

  it("does not publish optional metadata or done after cancellation during recovery", async () => {
    const { opts, events, controller } = setup([
      step([reply()]),
      step([call()], "tool_use"),
    ]);
    opts.processors = [
      {
        processOutputStep: ({ toolCalls }) => {
          if (toolCalls.length) controller.abort();
        },
      },
    ];
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events.filter((event) => event.type === "text")).toEqual([
      { type: "text", text: "Created your design." },
    ]);
  });

  it("publishes grounded metadata before done without a second model request or visible tool activity", async () => {
    const { opts, events, requests } = setup([
      [
        {
          type: "tool-input-start",
          id: "follow-up-1",
          name: FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
        },
        {
          type: "tool-input-delta",
          id: "follow-up-1",
          text: JSON.stringify({ suggestions: [followUp] }),
        },
        ...step([reply(), call()], "end_turn"),
      ],
    ]);
    const usage = await runAgentLoop(opts);
    expect(usage.llmCalls).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].systemPrompt).toBe(
      `${opts.systemPrompt}\n\n${FOLLOW_UP_SUGGESTIONS_INSTRUCTION}`,
    );
    expect(requests[0].messages[0]).toEqual(opts.messages[0]);
    expect(requests[0].tools.map((tool) => tool.name)).toContain(
      FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
    );
    expect(events.filter((event) => event.type !== "model_stream")).toEqual([
      { type: "suggestions", suggestions: [] },
      { type: "text", text: "Created your design." },
      {
        type: "suggestions",
        suggestions: [
          {
            ...followUp,
            id: "canonical-run:follow-up:1",
            runId: "canonical-run",
            updatedAt: expect.any(String),
          },
        ],
      },
      { type: "done" },
    ]);
  });

  it("stages a metadata-only call until the ordinary final reply without an empty-response retry", async () => {
    const { opts, events, requests } = setup([
      step([call()], "tool_use"),
      step([reply()]),
    ]);
    const usage = await runAgentLoop(opts);
    expect(usage.llmCalls).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[1].maxOutputTokens).toBe(requests[0].maxOutputTokens);
    expect(requests[1].reasoningEffort).toBe(requests[0].reasoningEffort);
    expect(requests[1].messages.at(-1)).toMatchObject({
      role: "user",
      content: [
        { type: "tool-result", toolName: FOLLOW_UP_SUGGESTIONS_TOOL_NAME },
      ],
    });
    expect(
      events.some(
        (event) =>
          event.type === "clear" ||
          event.type === "error" ||
          event.type === "auto_continue",
      ),
    ).toBe(false);
    expect(published(events)).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("keeps metadata tool pairing in model history but never hydrates it into visible thread history", async () => {
    const { opts, events } = setup([
      step([call()], "tool_use"),
      step([reply()]),
    ]);
    await runAgentLoop(opts);
    expect(opts.messages.flatMap((message) => message.content)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call",
          name: FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
          id: "follow-up-1",
        }),
        expect.objectContaining({
          type: "tool-result",
          toolName: FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
          toolCallId: "follow-up-1",
        }),
      ]),
    );
    const assistant = buildAssistantMessage(
      events.map((event, seq) => ({ event, seq })),
      "canonical-run",
    );
    expect(assistant?.content).toEqual([
      { type: "text", text: "Created your design." },
    ]);
    const saved = foldAssistantTurn({ messages: [] }, assistant!, {
      runId: "canonical-run",
      turnId: "turn-1",
    });
    const hydrated = normalizeThreadRepository(
      JSON.parse(JSON.stringify(saved)),
    );
    expect(hydrated.messages[0].message.content).toEqual(assistant!.content);
    expect(JSON.stringify(hydrated)).not.toContain(
      FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
    );
    expect(threadDataToEngineMessages(JSON.stringify(hydrated))).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Created your design." }],
      },
    ]);
  });

  it("lets the model decide after receiving grounded action results", async () => {
    const { opts, events, requests } = setup(
      [step([readCall], "tool_use"), step([reply(), call()])],
      { "read-artifact": read },
    );
    await runAgentLoop(opts);
    expect(requests[1].messages.at(-1)).toMatchObject({
      content: [
        {
          type: "tool-result",
          content: expect.stringContaining('"status": "saved"'),
        },
      ],
    });
    expect(published(events)).toHaveLength(1);
    expect(
      events.findIndex((event) => event.type === "tool_done"),
    ).toBeLessThan(
      events.findIndex(
        (event) => event.type === "suggestions" && event.suggestions.length > 0,
      ),
    );
  });

  it("preserves provider tool_use continuation when publication accompanies a preamble", async () => {
    const { opts, events, requests } = setup([
      step([reply("I'll wrap this up."), call()], "tool_use"),
      step([reply("Here is the actual final response.")]),
    ]);
    const guard = vi.fn(() => null);
    opts.finalResponseGuard = guard;
    await runAgentLoop(opts);
    expect(requests).toHaveLength(2);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Here is the actual final response." }),
    );
    expect(events.filter((event) => event.type === "text")).toEqual([
      { type: "text", text: "I'll wrap this up." },
      { type: "text", text: "Here is the actual final response." },
    ]);
    expect(published(events)).toHaveLength(1);
  });

  it("invalidates staged suggestions when another action changes grounding", async () => {
    const { opts, events } = setup(
      [
        step([call()], "tool_use"),
        step([readCall], "tool_use"),
        step([reply()]),
        step([call({ suggestions: [] })], "tool_use"),
      ],
      { "read-artifact": read },
    );
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(events.at(-2)).toEqual({ type: "suggestions", suggestions: [] });
  });

  it("rejects publication mixed with work whose result is not yet known", async () => {
    const { opts, events, requests } = setup(
      [step([readCall, call()], "tool_use"), step([reply()])],
      { "read-artifact": read },
    );
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(requests[1].messages.at(-1)).toMatchObject({
      content: expect.arrayContaining([
        expect.objectContaining({
          toolName: FOLLOW_UP_SUGGESTIONS_TOOL_NAME,
          isError: true,
        }),
      ]),
    });
  });

  it.each([false, true])(
    "respects an explicit empty decision without retrying it (after omission: %s)",
    async (omitted) => {
      const { opts, events, requests } = setup([
        ...(omitted
          ? [step([reply()]), step([call({ suggestions: [] })], "tool_use")]
          : [step([reply(), call({ suggestions: [] })])]),
      ]);
      await runAgentLoop(opts);
      expect(requests).toHaveLength(omitted ? 2 : 1);
      expect(published(events)).toEqual([]);
      expect(events.at(-2)).toEqual({ type: "suggestions", suggestions: [] });
    },
  );

  it("replaces a staged set with an explicit empty set", async () => {
    const { opts, events } = setup([
      step([call()], "tool_use"),
      step([reply(), call({ suggestions: [] }, "clear-follow-ups")]),
    ]);
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
  });

  it("returns invalid metadata as an internal error and never revives earlier valid chips", async () => {
    const { opts, events } = setup([
      step([call()], "tool_use"),
      step([
        reply(),
        call(
          { suggestions: [{ ...followUp, runId: "forged" }] },
          "invalid-follow-ups",
        ),
      ]),
    ]);
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(opts.messages.at(-1)).toMatchObject({
      content: [
        expect.objectContaining({
          type: "tool-result",
          isError: true,
          content: expect.stringContaining("Invalid follow-up"),
        }),
      ],
    });
  });

  it("discards staged suggestions when final-response validation requests a retry", async () => {
    const { opts, events } = setup([
      step([call()], "tool_use"),
      step([reply("Unverified draft")]),
      step([reply("Verified reply")]),
    ]);
    opts.finalResponseGuard = vi
      .fn()
      .mockReturnValueOnce("Verify first")
      .mockReturnValueOnce(null);
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(opts.finalResponseGuard).toHaveBeenCalledTimes(2);
  });

  it("does not publish suggestions beside a guard fallback", async () => {
    const { opts, events } = setup([step([reply(), call()])]);
    opts.finalResponseGuard = () => ({
      retryMessage: "Verify first",
      fallbackMessage: "Could not verify",
      maxRetries: 0,
    });
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
  });

  it("does not publish after cancellation at the final guard", async () => {
    const { opts, events, controller } = setup([step([reply(), call()])]);
    opts.finalResponseGuard = () => {
      controller.abort();
      return null;
    };
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("does not publish when result processing trips a guardrail", async () => {
    const { opts, events } = setup([step([reply(), call()])]);
    opts.processors = [
      {
        processOutputResult: () => {
          throw new TripWire("Response refused");
        },
      },
    ];
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events.some((event) => event.type === "error")).toBe(true);
  });

  it("does not publish when the provider fails after a staged set", async () => {
    const { opts, events } = setup([
      step([call()], "tool_use"),
      [
        {
          type: "stop",
          reason: "error",
          error: "Invalid request",
          statusCode: 400,
        },
      ],
    ]);
    await expect(runAgentLoop(opts)).rejects.toThrow("Invalid request");
    expect(published(events)).toEqual([]);
  });

  it("does not publish a staged set when paused for approval", async () => {
    const run = vi.fn();
    const { opts, events } = setup(
      [step([call()], "tool_use"), step([readCall], "tool_use")],
      { "read-artifact": { ...read, needsApproval: true, run } },
    );
    await runAgentLoop(opts);
    expect(run).not.toHaveBeenCalled();
    expect(published(events)).toEqual([]);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("does not persist staged suggestions across an unfinished stream boundary", async () => {
    const { opts, events } = setup([step([call()], "tool_use"), []]);
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(events.at(-1)).toEqual({
      type: "auto_continue",
      reason: "stream_ended",
    });
  });

  it("discards suggestions associated with a truncated reply", async () => {
    const { opts, events } = setup([
      step([reply(), call()], "max_tokens"),
      step([reply("Complete response")]),
    ]);
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
  });

  it("does not publish a staged set when final text arrives without a terminal marker", async () => {
    const { opts, events } = setup([
      step([call()], "tool_use"),
      [{ type: "text-delta", text: "Incomplete reply" }],
    ]);
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
  });

  it("does not publish after a metadata-only loop reaches the turn limit", async () => {
    const { opts, events } = setup([step([call()], "tool_use")]);
    opts.maxIterations = 1;
    await runAgentLoop(opts);
    expect(published(events)).toEqual([]);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("does not share buffered suggestions with another run", async () => {
    const first = setup([step([call()], "tool_use"), step([reply()])]);
    const second = setup([step([reply()])]);
    second.opts.runId = "other-run";
    await Promise.all([runAgentLoop(first.opts), runAgentLoop(second.opts)]);
    expect(published(first.events)).toHaveLength(1);
    expect(published(second.events)).toEqual([]);
  });

  it("requires the host run id and never lets the model supply identity", async () => {
    const { opts } = setup([]);
    opts.runId = undefined;
    await expect(runAgentLoop(opts)).rejects.toThrow("canonical run id");
  });

  it("does not add response tools to non-interactive or unsupported loop callers", async () => {
    const { opts, requests, events } = setup([step([reply()])]);
    opts.followUpSuggestions = false;
    await runAgentLoop(opts);
    expect(requests[0].tools).toEqual([]);
    expect(requests[0].systemPrompt).toBe(opts.systemPrompt);
    expect(events.some((event) => event.type === "suggestions")).toBe(false);
  });
});
