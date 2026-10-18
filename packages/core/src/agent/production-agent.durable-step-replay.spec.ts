import { beforeEach, describe, expect, it, vi } from "vitest";

import { MCP_ACTION_RESULT_MARKER } from "../mcp-client/app-result.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import { withExecutionFence } from "./execution-fence.js";
import type { AgentLoopFinalResponseGuardContext } from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

const durableStep = vi.hoisted(() => ({
  resultJson: undefined as string | undefined,
}));

vi.mock("./run-store.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./run-store.js")>();
  return {
    ...original,
    beginAgentExecutionStep: vi.fn(async () =>
      durableStep.resultJson === undefined
        ? { status: "execute" as const, wasDispatched: false }
        : {
            status: "completed" as const,
            resultJson: durableStep.resultJson,
            errorJson: null,
          },
    ),
    markAgentExecutionStepDispatched: vi.fn(async () => {}),
    completeAgentExecutionStep: vi.fn(async (_intent, resultJson: string) => {
      durableStep.resultJson = resultJson;
    }),
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
const toolCall = (): EngineContentPart => ({
  type: "tool-call",
  id: "step-1",
  name: "create-deck",
  input: {},
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
});

describe("durable execution step replay", () => {
  it("fails closed when the complete replay projection exceeds its size bound", async () => {
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
        actions: {
          "create-deck": {
            tool: {
              description: "Create a deck",
              parameters: { type: "object", properties: {} },
            },
            readOnly: false,
            run: async () => ({
              [MCP_ACTION_RESULT_MARKER]: true,
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
            }),
          },
        },
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );

    await expect(run).rejects.toThrow(
      "Execution step outcome exceeds its durable size limit",
    );
    expect(durableStep.resultJson).toBeUndefined();
    expect(
      events.find(
        (event): event is Extract<AgentChatEvent, { type: "tool_done" }> =>
          event.type === "tool_done",
      ),
    ).toMatchObject({ isError: true, outcomeUnknown: true });
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
});
