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

const { runAgentLoop } = await import("./production-agent.js");

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
          durableStepIdForToolCall: (toolCallId) =>
            `${namespace}:${toolCallId}`,
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
    expect(durableStep.completedSteps.map((step) => step.stepId)).toEqual([
      "custom-profile-a:call_0",
      "custom-profile-b:call_0",
    ]);

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
