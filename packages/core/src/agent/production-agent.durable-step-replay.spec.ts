import { beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import { withExecutionFence } from "./execution-fence.js";
import type { AgentLoopFinalResponseGuardContext } from "./production-agent.js";
import type { AgentExecutionStepIntent } from "./run-store.js";
import type { AgentChatEvent } from "./types.js";

const durableStep = vi.hoisted(() => ({
  resultJson: undefined as string | undefined,
  priorEvents: [] as AgentChatEvent[],
  completedSteps: [] as {
    stepId: string;
    operationId: string;
    toolName: string;
    inputJson: string;
    resultJson: string;
  }[],
}));

vi.mock("./run-store.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...original,
    getCurrentTurnEventsForThread: vi.fn(async () => durableStep.priorEvents),
    getCompletedAgentExecutionSteps: vi.fn(
      async (_threadId: string, _turnId: string, stepIds: string[]) =>
        durableStep.completedSteps.filter((step) =>
          stepIds.includes(step.stepId),
        ),
    ),
    beginAgentExecutionStep: vi.fn(async (intent: AgentExecutionStepIntent) => {
      const completed = durableStep.completedSteps.find(
        (step) => step.stepId === intent.stepId,
      );
      return completed
        ? {
            status: "completed" as const,
            resultJson: completed.resultJson,
            errorJson: null,
          }
        : { status: "execute" as const, wasDispatched: false };
    }),
    markAgentExecutionStepDispatched: vi.fn(async () => {}),
    markAgentExecutionStepUnknown: vi.fn(async () => {}),
    completeAgentExecutionStep: vi.fn(
      async (intent: AgentExecutionStepIntent, resultJson: string) => {
        durableStep.resultJson = resultJson;
        durableStep.completedSteps.push({
          stepId: intent.stepId,
          operationId: intent.operationId,
          toolName: intent.toolName,
          inputJson: intent.inputJson,
          resultJson,
        });
      },
    ),
  };
});

const {
  AGENT_INTERNAL_CONTINUE_PROMPT,
  AGENT_INTERNAL_CONTINUATION_CHECKPOINT_PROMPT,
  runAgentLoop,
} = await import("./production-agent.js");

const fence = {
  threadId: "durable-thread",
  turnId: "durable-turn",
  runId: "durable-run",
  generation: "7",
};
const receipt = {
  changed: true,
  verified: false as const,
  summary: "The deck was saved, but not checked.",
};
const mcpApp = {
  serverId: "mcp-server",
  toolName: "create-deck",
  originalToolName: "create-deck",
  resourceUri: "ui://decks/deck-1",
  toolInput: {},
  toolResult: { content: [{ type: "text", text: "Deck saved" }] },
};
const toolCall = (
  id = "step-1",
  input: Record<string, unknown> = {},
): EngineContentPart => ({
  type: "tool-call",
  id,
  name: "create-deck",
  input,
});
const text = (value: string): EngineContentPart => ({
  type: "text",
  text: value,
});

function engineFor(
  turns: EngineContentPart[][],
  seenMessages: string[],
): AgentEngine {
  let streamCall = 0;
  return {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(streamOpts): AsyncIterable<EngineEvent> {
      seenMessages.push(JSON.stringify(streamOpts.messages));
      const parts = turns[streamCall++] ?? [text("(script exhausted)")];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts.some((part) => part.type === "tool-call")
          ? "tool_use"
          : "end_turn",
      };
    },
  };
}

beforeEach(() => {
  durableStep.resultJson = undefined;
  durableStep.priorEvents = [];
  durableStep.completedSteps = [];
});

describe("durable execution step replay", () => {
  it("preserves separate durable identities when one response reuses a provider call id", async () => {
    const actionRun = vi.fn(
      async (input: { id: string }) => `Deck ${input.id}`,
    );
    const action = {
      tool: {
        description: "Create a deck",
        parameters: {
          type: "object" as const,
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      readOnly: false,
      run: actionRun,
    };
    const seenMessages: string[] = [];
    const events: AgentChatEvent[] = [];

    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(
          [
            [
              toolCall("reused-provider-id", { id: "first" }),
              toolCall("reused-provider-id", { id: "second" }),
            ],
            [text("Both decks are ready.")],
          ],
          seenMessages,
        ),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Create both decks." }],
          },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(2);
    expect(durableStep.completedSteps).toHaveLength(2);
    expect(durableStep.completedSteps[0]?.stepId).not.toBe(
      durableStep.completedSteps[1]?.stepId,
    );
    expect(
      events
        .filter((event) => event.type === "tool_done")
        .map((event) => event.executionStepId),
    ).toEqual([
      durableStep.completedSteps[0]?.stepId,
      durableStep.completedSteps[1]?.stepId,
    ]);
    const history = JSON.parse(seenMessages[1]!) as Array<{
      role: string;
      content: Array<{ type: string; executionStepId?: string }>;
    }>;
    const calls = history.flatMap((message) =>
      message.role === "assistant"
        ? message.content.filter((part) => part.type === "tool-call")
        : [],
    );
    const results = history.flatMap((message) =>
      message.role === "user"
        ? message.content.filter((part) => part.type === "tool-result")
        : [],
    );
    expect(calls.map((part) => part.executionStepId)).toEqual(
      results.map((part) => part.executionStepId),
    );
  });

  it("retries an interrupted safe call with its persisted identity after continuation context changes", async () => {
    const input = { id: "doc-1" };
    durableStep.priorEvents = [
      {
        type: "tool_start",
        id: "provider-id-before-reconnect",
        executionStepId: "stable-read-step",
        tool: "get-document",
        input,
      },
    ];
    const actionRun = vi.fn(async () => "Document contents");
    const action = {
      tool: {
        description: "Read a document",
        parameters: {
          type: "object" as const,
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      readOnly: true,
      run: actionRun,
    };
    const { beginAgentExecutionStep } = await import("./run-store.js");
    vi.mocked(beginAgentExecutionStep).mockImplementationOnce(
      async (intent) => {
        expect(intent.stepId).toBe("stable-read-step");
        return { status: "execute", wasDispatched: true };
      },
    );
    const events: AgentChatEvent[] = [];
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "Read doc-1." }],
      },
      {
        role: "assistant" as const,
        content: [
          {
            type: "text" as const,
            text: `${AGENT_INTERNAL_CONTINUATION_CHECKPOINT_PROMPT}\n\npartial output`,
          },
        ],
      },
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `${AGENT_INTERNAL_CONTINUE_PROMPT}\n\nInternal note: Tool-call journal from the interrupted attempt`,
          },
        ],
      },
    ];

    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(
          [
            [
              {
                type: "tool-call",
                id: "provider-id-after-reconnect",
                name: "get-document",
                input,
              },
            ],
            [text("The document is ready.")],
          ],
          [],
        ),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages,
        actions: { "get-document": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "provider-id-after-reconnect",
        executionStepId: "stable-read-step",
        result: "Document contents",
      }),
    );
  });

  it("binds an interrupted safe write to only one identical resumed call", async () => {
    const input = { id: "deck-1" };
    durableStep.priorEvents = [
      {
        type: "tool_start",
        id: "provider-id-before-reconnect",
        executionStepId: "interrupted-create-step",
        tool: "create-deck",
        input,
      },
    ];
    const actionRun = vi.fn(async () => `Write ${actionRun.mock.calls.length}`);
    const action = {
      tool: {
        description: "Create a deck",
        parameters: {
          type: "object" as const,
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      readOnly: false,
      retrySafe: true,
      parallelSafe: true,
      run: actionRun,
    };
    const { beginAgentExecutionStep } = await import("./run-store.js");
    vi.mocked(beginAgentExecutionStep).mockImplementationOnce(
      async (intent) => {
        expect(intent.stepId).toBe("interrupted-create-step");
        return { status: "execute", wasDispatched: true };
      },
    );
    const events: AgentChatEvent[] = [];

    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(
          [
            [
              toolCall("provider-id-after-reconnect-one", input),
              toolCall("provider-id-after-reconnect-two", input),
            ],
            [text("Both writes are ready.")],
          ],
          [],
        ),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        internalContinuation: true,
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(2);
    expect(durableStep.completedSteps).toHaveLength(2);
    expect(durableStep.completedSteps[0]?.stepId).toBe(
      "interrupted-create-step",
    );
    expect(durableStep.completedSteps[1]?.stepId).not.toBe(
      "interrupted-create-step",
    );
    expect(
      events
        .filter((event) => event.type === "tool_done")
        .map(({ id, executionStepId, result }) => ({
          id,
          executionStepId,
          result,
        })),
    ).toEqual([
      expect.objectContaining({
        id: "provider-id-after-reconnect-one",
        executionStepId: "interrupted-create-step",
        result: "Write 1",
      }),
      expect.objectContaining({
        id: "provider-id-after-reconnect-two",
        executionStepId: durableStep.completedSteps[1]?.stepId,
        result: "Write 2",
      }),
    ]);
  });

  it("stops when a legacy write result cannot be attributed across duplicate history calls", async () => {
    const input = { id: "deck-1" };
    durableStep.priorEvents = [
      {
        type: "tool_start",
        id: "legacy-provider-id",
        tool: "create-deck",
        input,
      },
      {
        type: "tool_done",
        id: "legacy-provider-id",
        tool: "create-deck",
        input,
        result: "Deck saved",
        completedSideEffect: true,
      },
    ];
    const actionRun = vi.fn(async () => "Deck saved again");
    const historyCall = (id: string): EngineContentPart => ({
      type: "tool-call",
      id,
      name: "create-deck",
      input,
    });
    const events: AgentChatEvent[] = [];

    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(
          [[toolCall("resumed-provider-id", input)], [text("Stopped safely.")]],
          [],
        ),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
          {
            role: "assistant",
            content: [
              historyCall("legacy-provider-id"),
              historyCall("legacy-provider-id"),
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "legacy-provider-id",
                toolName: "create-deck",
                toolInput: JSON.stringify(input),
                content: "Deck saved",
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: AGENT_INTERNAL_CONTINUE_PROMPT }],
          },
        ],
        actions: {
          "create-deck": {
            tool: {
              description: "Create a deck",
              parameters: {
                type: "object" as const,
                properties: { id: { type: "string" } },
                required: ["id"],
              },
            },
            readOnly: false,
            run: actionRun,
          },
        },
        threadId: fence.threadId,
        turnId: fence.turnId,
        internalContinuation: true,
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "resumed-provider-id",
        isError: true,
        result: expect.stringContaining("I stopped without running it again"),
      }),
    );
  });

  it("keeps the durable step identity when tool input repair replaces the call object", async () => {
    let streamCall = 0;
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
        parallelToolCalls: false,
      },
      async *stream(): AsyncIterable<EngineEvent> {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "tool-call-error",
            id: "repaired-provider-id",
            name: "update-source",
            input: {
              id: "source-1",
              config: '{"host":"db.example.com","port":5432}',
            },
            error: "input/config must be object",
          };
          yield { type: "assistant-content", parts: [] };
          yield { type: "stop", reason: "tool_use" };
          return;
        }
        yield {
          type: "assistant-content",
          parts: [text("Updated.")],
        };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const actionRun = vi.fn(async () => "Updated source");
    const events: AgentChatEvent[] = [];

    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Update the source." }],
          },
        ],
        actions: {
          "update-source": {
            tool: {
              description: "Update source",
              parameters: {
                type: "object" as const,
                properties: {
                  id: { type: "string" },
                  config: { type: "object" },
                },
                required: ["id", "config"],
              },
            },
            readOnly: false,
            run: actionRun,
          },
        },
        threadId: fence.threadId,
        turnId: fence.turnId,
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );

    const toolStart = events.find(
      (event) =>
        event.type === "tool_start" && event.id === "repaired-provider-id",
    );
    expect(actionRun).toHaveBeenCalledOnce();
    expect(actionRun).toHaveBeenCalledWith(
      { id: "source-1", config: { host: "db.example.com", port: 5432 } },
      expect.any(Object),
    );
    expect(toolStart).toEqual(
      expect.objectContaining({ executionStepId: expect.any(String) }),
    );
    expect(durableStep.completedSteps).toContainEqual(
      expect.objectContaining({ stepId: toolStart?.executionStepId }),
    );
  });

  it("does not dispatch a write if cancellation arrives during the dispatch marker", async () => {
    const actionRun = vi.fn(async () => "Deck saved");
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
    };
    let enterMarker!: () => void;
    let releaseMarker!: () => void;
    const markerEntered = new Promise<void>((resolve) => {
      enterMarker = resolve;
    });
    const markerGate = new Promise<void>((resolve) => {
      releaseMarker = resolve;
    });
    const {
      claimTurnExecutionLease,
      insertRun,
      markAgentExecutionStepDispatched,
      markAgentExecutionStepUnknown,
    } = await import("./run-store.js");
    const runId = `durable-marker-cancel-${Date.now()}`;
    const threadId = `thread-${runId}`;
    const turnId = runId;
    await insertRun(runId, threadId, turnId);
    const executionFence = await claimTurnExecutionLease(
      threadId,
      turnId,
      runId,
    );
    vi.mocked(markAgentExecutionStepDispatched).mockImplementationOnce(
      async () => {
        enterMarker();
        await markerGate;
      },
    );
    vi.mocked(markAgentExecutionStepUnknown).mockImplementationOnce(
      async () => {},
    );
    const controller = new AbortController();
    const pending = withExecutionFence(executionFence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall()]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId,
        turnId,
        send: () => {},
        signal: controller.signal,
      }),
    );

    await markerEntered;
    controller.abort();
    releaseMarker();
    await pending;

    expect(actionRun).not.toHaveBeenCalled();
  });

  it("bounds an oversized replay projection without losing the committed result", async () => {
    const actionRun = vi.fn(async () => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: "Deck saved",
      raw: { deckId: "deck-1" },
      serverId: "mcp-server",
      toolName: "create-deck",
      originalToolName: "create-deck",
      input: {},
      mcpApp: {
        ...mcpApp,
        toolResult: { content: [], oversized: "x".repeat(600 * 1024) },
      },
    }));
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
    };
    const events: AgentChatEvent[] = [];
    const run = withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall()]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        send: (event) => {
          if (event.type === "tool_done") {
            throw new Error("simulated process stop after durable completion");
          }
          events.push(event);
        },
        signal: new AbortController().signal,
      }),
    );

    await expect(run).rejects.toThrow(
      "simulated process stop after durable completion",
    );
    expect(actionRun).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === "tool_done")).toBe(false);
    expect(durableStep.resultJson).toBeDefined();
    const storedOutcome = JSON.parse(durableStep.resultJson!);
    expect(storedOutcome).toMatchObject({
      result: expect.stringContaining("Deck saved"),
      completedSideEffect: true,
      replayTruncated: true,
      replayOmittedFields: expect.arrayContaining(["mcpApp"]),
    });
    expect(storedOutcome.mcpApp).toBeUndefined();
    expect(Buffer.byteLength(durableStep.resultJson!, "utf8")).toBeLessThan(
      512 * 1024,
    );

    const resumedEvents: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall()], [text("The deck is ready.")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        send: (event) => resumedEvents.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(1);
    expect(resumedEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        replayed: true,
        completedSideEffect: true,
        result: expect.stringContaining(
          "Some result details were too large to retain for recovery.",
        ),
      }),
    );
  });

  it("replays the persisted receipt and event projection after completion precedes tool_done", async () => {
    const actionRun = vi.fn(async () => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: "Deck saved",
      raw: { deckId: "deck-1", title: "Quarterly plan", _receipt: receipt },
      serverId: "mcp-server",
      toolName: "create-deck",
      originalToolName: "create-deck",
      input: {},
      mcpApp,
    }));
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
      chatUI: {
        renderer: "test.deck",
        title: "Quarterly plan",
        projectResult: (_args: Record<string, unknown>, result: unknown) => ({
          content: result,
          selectedDeck: "deck-1",
        }),
      },
      fileMutationProof: () => ({
        path: "decks/quarterly-plan.json",
        contentSha256: "abc123",
      }),
    };
    const firstRunEvents: AgentChatEvent[] = [];
    const firstRunEngine = engineFor([[toolCall()]], []);
    const firstRun = withExecutionFence(fence, () =>
      runAgentLoop({
        engine: firstRunEngine,
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        send: (event) => {
          if (event.type === "tool_done")
            throw new Error("simulated process stop");
          firstRunEvents.push(event);
        },
        signal: new AbortController().signal,
      }),
    );

    await expect(firstRun).rejects.toThrow("simulated process stop");
    expect(actionRun).toHaveBeenCalledTimes(1);
    expect(firstRunEvents.some((event) => event.type === "tool_done")).toBe(
      false,
    );
    expect(durableStep.resultJson).toBeDefined();
    const storedOutcome = JSON.parse(durableStep.resultJson!);
    expect(storedOutcome).toMatchObject({
      receipt,
      mcpApp,
      chatUI: { renderer: "test.deck", title: "Quarterly plan" },
      chatUIResult: { content: "Deck saved", selectedDeck: "deck-1" },
      fileMutation: {
        path: "decks/quarterly-plan.json",
        contentSha256: "abc123",
      },
      artifacts: [{ kind: "deck", id: "deck-1", title: "Quarterly plan" }],
    });
    expect(Buffer.byteLength(durableStep.resultJson!, "utf8")).toBeLessThan(
      512 * 1024,
    );

    const resumedEvents: AgentChatEvent[] = [];
    const seenMessages: string[] = [];
    const guardContexts: AgentLoopFinalResponseGuardContext[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(
          [
            [toolCall()],
            [text("The deck is ready."), text("")],
            [text("Saved, but not verified.")],
          ],
          seenMessages,
        ),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        send: (event) => resumedEvents.push(event),
        signal: new AbortController().signal,
        finalResponseGuard: (context) => {
          guardContexts.push(context);
          return null;
        },
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(1);
    const replayed = resumedEvents.find(
      (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
        event.type === "tool_done",
    );
    expect(replayed).toMatchObject({
      replayed: true,
      mcpApp,
      chatUI: { renderer: "test.deck", title: "Quarterly plan" },
      chatUIResult: { content: "Deck saved", selectedDeck: "deck-1" },
      fileMutation: {
        path: "decks/quarterly-plan.json",
        contentSha256: "abc123",
      },
      artifacts: [{ kind: "deck", id: "deck-1", title: "Quarterly plan" }],
    });
    expect(guardContexts[0]?.receipts).toEqual([
      { tool: "create-deck", ...receipt },
    ]);
    expect(seenMessages[2]).toContain("The deck was saved, but not checked.");
  });

  it("recovers a completed reaper step when the provider regenerates its call with a new id", async () => {
    const actionRun = vi.fn(async () => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: "Deck saved",
      raw: { deckId: "deck-1", title: "Quarterly plan", _receipt: receipt },
      serverId: "mcp-server",
      toolName: "create-deck",
      originalToolName: "create-deck",
      input: {},
      mcpApp,
    }));
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
    };
    const persistedEvents: AgentChatEvent[] = [];
    const interrupted = withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall("provider-id-before-reaper")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        send: (event) => {
          if (event.type === "tool_done")
            throw new Error("simulated stop after durable completion");
          persistedEvents.push(event);
        },
        signal: new AbortController().signal,
      }),
    );

    await expect(interrupted).rejects.toThrow(
      "simulated stop after durable completion",
    );
    expect(actionRun).toHaveBeenCalledTimes(1);
    expect(
      persistedEvents.filter((event) => event.type === "tool_start"),
    ).toEqual([
      expect.objectContaining({
        type: "tool_start",
        id: "provider-id-before-reaper",
        tool: "create-deck",
      }),
    ]);

    durableStep.priorEvents = persistedEvents;
    const firstReaperEvents: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(
          [
            [toolCall("provider-id-before-reaper")],
            [text("The deck is ready.")],
          ],
          [],
        ),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        recoverCompletedExecutionSteps: true,
        send: (event) => firstReaperEvents.push(event),
        signal: new AbortController().signal,
      }),
    );
    expect(firstReaperEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "provider-id-before-reaper",
        completedSideEffect: true,
        replayed: true,
      }),
    );

    durableStep.priorEvents = [...persistedEvents, ...firstReaperEvents];
    const resumedEvents: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(
          [
            [toolCall("provider-id-after-reaper")],
            [text("The deck is ready.")],
          ],
          [],
        ),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        recoverCompletedExecutionSteps: true,
        send: (event) => resumedEvents.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(1);
    expect(resumedEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "provider-id-after-reaper",
        tool: "create-deck",
        result: expect.stringContaining("Deck saved"),
        completedSideEffect: true,
        replayed: true,
      }),
    );
  });

  it("runs an intentional identical write after its prior result is in turn history", async () => {
    const actionRun = vi.fn(async () => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: "Deck saved",
      raw: { deckId: "deck-1", _receipt: receipt },
      serverId: "mcp-server",
      toolName: "create-deck",
      originalToolName: "create-deck",
      input: {},
      mcpApp,
    }));
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
    };
    const firstEvents: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall("first-call")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        send: (event) => firstEvents.push(event),
        signal: new AbortController().signal,
      }),
    );
    durableStep.priorEvents = firstEvents;

    const secondEvents: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall("second-call")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
          { role: "assistant", content: [toolCall("first-call")] },
          {
            role: "user",
            content: [
              {
                type: "tool-result",
                toolCallId: "first-call",
                toolName: "create-deck",
                toolInput: "{}",
                content: "Deck saved",
              },
            ],
          },
        ],
        actions: { "create-deck": action },
        send: (event) => secondEvents.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(2);
    expect(durableStep.completedSteps).toHaveLength(2);
    expect(durableStep.completedSteps[1]?.stepId).not.toBe(
      durableStep.completedSteps[0]?.stepId,
    );
    expect(secondEvents).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "second-call",
        completedSideEffect: true,
        result: expect.stringContaining("Deck saved"),
      }),
    );
    expect(secondEvents).not.toContainEqual(
      expect.objectContaining({ type: "tool_done", replayed: true }),
    );
  });

  it("keeps reused provider call ids separate across custom-agent loops", async () => {
    const actionRun = vi.fn(async () => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: "Deck saved",
      raw: { deckId: "deck-1", _receipt: receipt },
      serverId: "mcp-server",
      toolName: "create-deck",
      originalToolName: "create-deck",
      input: {},
      mcpApp,
    }));
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
    };
    const runCustomLoop = async (namespace: string) => {
      const events: AgentChatEvent[] = [];
      await withExecutionFence(fence, () =>
        runAgentLoop({
          engine: engineFor([[toolCall("call_0")], [text("Done.")]], []),
          model: "test-model",
          systemPrompt: "system",
          tools: [],
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "Create a deck." }],
            },
          ],
          actions: { "create-deck": action },
          threadId: fence.threadId,
          turnId: fence.turnId,
          durableStepIdForToolCall: (logicalStepId) =>
            `${namespace}:${logicalStepId}`,
          recoverCompletedExecutionSteps: true,
          send: (event) => events.push(event),
          signal: new AbortController().signal,
        }),
      );
      return events;
    };

    await runCustomLoop("custom-profile-a");
    await runCustomLoop("custom-profile-b");

    expect(actionRun).toHaveBeenCalledTimes(2);
    const [firstStepId, secondStepId] = durableStep.completedSteps.map(
      (step) => step.stepId,
    );
    expect(firstStepId).toMatch(/^custom-profile-a:model-step:/);
    expect(secondStepId).toMatch(/^custom-profile-b:model-step:/);
    expect(firstStepId).not.toBe(secondStepId);

    const recovered = await runCustomLoop("custom-profile-a");
    expect(actionRun).toHaveBeenCalledTimes(2);
    expect(recovered).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        id: "call_0",
        replayed: true,
        completedSideEffect: true,
      }),
    );
  });

  it("fails closed when a completed committed step conflicts with a noncommitted done event", async () => {
    const actionRun = vi.fn(async () => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: "Deck saved",
      raw: { deckId: "deck-1", title: "Quarterly plan", _receipt: receipt },
      serverId: "mcp-server",
      toolName: "create-deck",
      originalToolName: "create-deck",
      input: {},
      mcpApp,
    }));
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
    };
    const persistedEvents: AgentChatEvent[] = [];
    const interrupted = withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall("provider-id-before-reaper")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        send: (event) => {
          if (event.type === "tool_done") {
            persistedEvents.push({ ...event, completedSideEffect: false });
            throw new Error("simulated contradictory persisted event");
          }
          persistedEvents.push(event);
        },
        signal: new AbortController().signal,
      }),
    );

    await expect(interrupted).rejects.toThrow(
      "simulated contradictory persisted event",
    );
    expect(actionRun).toHaveBeenCalledTimes(1);
    durableStep.priorEvents = persistedEvents;

    const resumedEvents: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall("provider-id-after-reaper")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        recoverCompletedExecutionSteps: true,
        send: (event) => resumedEvents.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(1);
    expect(resumedEvents).not.toContainEqual(
      expect.objectContaining({
        type: "tool_start",
        id: "provider-id-after-reaper",
      }),
    );
    expect(resumedEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "tool_call_journal_unreadable",
      }),
    );
  });

  it("does not dispatch when a completed reaper step has malformed evidence", async () => {
    const actionRun = vi.fn(async () => ({
      [MCP_ACTION_RESULT_MARKER]: true as const,
      text: "Deck saved",
      raw: { deckId: "deck-1", title: "Quarterly plan", _receipt: receipt },
      serverId: "mcp-server",
      toolName: "create-deck",
      originalToolName: "create-deck",
      input: {},
      mcpApp,
    }));
    const action = {
      tool: {
        description: "Create a deck",
        parameters: { type: "object" as const, properties: {} },
      },
      readOnly: false,
      run: actionRun,
    };
    const persistedEvents: AgentChatEvent[] = [];
    const interrupted = withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall("provider-id-before-reaper")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        send: (event) => {
          if (event.type === "tool_done")
            throw new Error("simulated stop after durable completion");
          persistedEvents.push(event);
        },
        signal: new AbortController().signal,
      }),
    );

    await expect(interrupted).rejects.toThrow(
      "simulated stop after durable completion",
    );
    durableStep.priorEvents = persistedEvents;
    durableStep.completedSteps[0]!.resultJson = "{invalid-json";

    const resumedEvents: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor([[toolCall("provider-id-after-reaper")]], []),
        model: "test-model",
        systemPrompt: "system",
        tools: [],
        messages: [
          { role: "user", content: [{ type: "text", text: "Create a deck." }] },
        ],
        actions: { "create-deck": action },
        threadId: fence.threadId,
        turnId: fence.turnId,
        recoverCompletedExecutionSteps: true,
        send: (event) => resumedEvents.push(event),
        signal: new AbortController().signal,
      }),
    );

    expect(actionRun).toHaveBeenCalledTimes(1);
    expect(resumedEvents).not.toContainEqual(
      expect.objectContaining({
        type: "tool_start",
        id: "provider-id-after-reaper",
      }),
    );
    expect(resumedEvents).toContainEqual(
      expect.objectContaining({
        type: "error",
        errorCode: "tool_call_journal_unreadable",
      }),
    );
  });
});
