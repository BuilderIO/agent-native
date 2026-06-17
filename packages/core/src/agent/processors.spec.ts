import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "./production-agent.js";
import type { Processor } from "./processors.js";
import type { AgentEngine, EngineEvent } from "./engine/types.js";
import type { ActionEntry as ProductionActionEntry } from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const capabilities = {
  thinking: false,
  promptCaching: false,
  vision: false,
  computerUse: false,
  parallelToolCalls: true,
} as const;

/** A mock engine that replays a fixed script of event arrays, one per stream() call. */
function scriptedEngine(scripts: EngineEvent[][]): AgentEngine {
  let call = 0;
  return {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    capabilities,
    async *stream(): AsyncIterable<EngineEvent> {
      const script = scripts[Math.min(call, scripts.length - 1)];
      call += 1;
      for (const event of script) {
        yield event;
      }
    },
  };
}

function textTurn(text: string): EngineEvent[] {
  return [
    { type: "text-delta", text },
    { type: "assistant-content", parts: [{ type: "text", text }] },
    { type: "stop", reason: "end_turn" },
  ];
}

function toolTurn(id: string, name: string, input: unknown): EngineEvent[] {
  return [
    {
      type: "assistant-content",
      parts: [{ type: "tool-call", id, name, input }],
    },
    { type: "stop", reason: "tool_use" },
  ];
}

function readOnlyAction(
  run: (args: unknown) => unknown,
): ProductionActionEntry {
  return {
    tool: {
      description: "Test action",
      parameters: { type: "object", properties: {} },
    },
    readOnly: true,
    run: async (args) => run(args),
  } as ProductionActionEntry;
}

function baseOpts(
  engine: AgentEngine,
  send: (event: AgentChatEvent) => void,
  extra: Partial<Parameters<typeof runAgentLoop>[0]> = {},
): Parameters<typeof runAgentLoop>[0] {
  return {
    engine,
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    actions: {},
    send,
    signal: new AbortController().signal,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// (a) No processors → loop unchanged, normal completion
// ---------------------------------------------------------------------------

describe("processor seam — no processors", () => {
  it("completes normally and emits no tripwire when no processors are passed", async () => {
    const events: AgentChatEvent[] = [];
    await runAgentLoop(
      baseOpts(scriptedEngine([textTurn("hello")]), (e) => events.push(e)),
    );

    expect(events).toContainEqual({ type: "text", text: "hello" });
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "tripwire")).toBe(false);
  });

  it("completes normally with an empty processors array", async () => {
    const events: AgentChatEvent[] = [];
    await runAgentLoop(
      baseOpts(scriptedEngine([textTurn("hi")]), (e) => events.push(e), {
        processors: [],
      }),
    );

    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "tripwire")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) processOutputStream calls abort() → run halts + emits tripwire
// ---------------------------------------------------------------------------

describe("processor seam — processOutputStream abort", () => {
  it("halts the run and emits a tripwire when a stream processor aborts", async () => {
    const events: AgentChatEvent[] = [];
    let resultText: string | undefined;
    const processor: Processor = {
      name: "no-secrets",
      processOutputStream({ part, abort }) {
        if (part.type === "text-delta" && part.text.includes("secret")) {
          abort("Blocked: secret detected", { matched: "secret" });
        }
      },
      processOutputResult({ text }) {
        resultText = text;
      },
    };

    await runAgentLoop(
      baseOpts(
        scriptedEngine([textTurn("here is a secret value")]),
        (e) => events.push(e),
        { processors: [processor] },
      ),
    );

    const tripwire = events.find((e) => e.type === "tripwire");
    expect(tripwire).toEqual({
      type: "tripwire",
      reason: "Blocked: secret detected",
      processor: "no-secrets",
    });
    // The reason is surfaced as a final assistant message.
    expect(events).toContainEqual({
      type: "text",
      text: "Blocked: secret detected",
    });
    // A tripwired run does NOT end with a normal `done`.
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(resultText).toBe("Blocked: secret detected");
  });
});

// ---------------------------------------------------------------------------
// (c) processOutputStep sees tool calls and can abort
// ---------------------------------------------------------------------------

describe("processor seam — processOutputStep abort", () => {
  it("sees the model's requested tool calls and can abort before they run", async () => {
    const events: AgentChatEvent[] = [];
    const run = vi.fn(() => "ran");
    let seenToolCalls: { id: string; name: string; input: unknown }[] = [];

    const processor: Processor = {
      name: "no-deletes",
      processOutputStep({ toolCalls, finishReason, abort }) {
        seenToolCalls = toolCalls;
        expect(finishReason).toBe("tool_use");
        if (toolCalls.some((c) => c.name === "delete-everything")) {
          abort("Blocked dangerous tool call");
        }
      },
    };

    await runAgentLoop(
      baseOpts(
        scriptedEngine([
          toolTurn("call-1", "delete-everything", { confirm: true }),
        ]),
        (e) => events.push(e),
        {
          processors: [processor],
          actions: { "delete-everything": readOnlyAction(run) },
        },
      ),
    );

    expect(seenToolCalls).toEqual([
      { id: "call-1", name: "delete-everything", input: { confirm: true } },
    ]);
    // Aborting in the step hook prevents the tool from ever executing.
    expect(run).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "tripwire",
      reason: "Blocked dangerous tool call",
      processor: "no-deletes",
    });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("sees zero tool calls and an end_turn finish reason on a final answer", async () => {
    const seen: {
      toolCalls: unknown[];
      finishReason?: string;
      hasUsage: boolean;
    }[] = [];
    const processor: Processor = {
      processOutputStep({ toolCalls, finishReason, usage }) {
        seen.push({
          toolCalls,
          finishReason,
          hasUsage: usage !== undefined,
        });
      },
    };

    const engine = scriptedEngine([
      [
        { type: "text-delta", text: "done" },
        { type: "assistant-content", parts: [{ type: "text", text: "done" }] },
        {
          type: "usage",
          inputTokens: 5,
          outputTokens: 3,
        },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    await runAgentLoop(baseOpts(engine, () => {}, { processors: [processor] }));

    expect(seen).toEqual([
      { toolCalls: [], finishReason: "end_turn", hasUsage: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// (d) per-processor state persists across chunks + is isolated between processors
// ---------------------------------------------------------------------------

describe("processor seam — per-processor state", () => {
  it("persists state across chunks and isolates it between processors", async () => {
    // Two text deltas in one turn so processOutputStream fires twice.
    const engine = scriptedEngine([
      [
        { type: "text-delta", text: "aa" },
        { type: "text-delta", text: "bb" },
        {
          type: "assistant-content",
          parts: [{ type: "text", text: "aabb" }],
        },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const counterA: number[] = [];
    const counterB: number[] = [];
    const sawOtherKey: boolean[] = [];

    const procA: Processor = {
      name: "A",
      processOutputStream({ part, state }) {
        if (part.type !== "text-delta") return;
        // State persists across chunks for this processor.
        state.count = ((state.count as number) ?? 0) + 1;
        counterA.push(state.count as number);
        state.charsA = ((state.charsA as string) ?? "") + part.text;
      },
    };
    const procB: Processor = {
      name: "B",
      processOutputStream({ part, state }) {
        if (part.type !== "text-delta") return;
        state.count = ((state.count as number) ?? 0) + 1;
        counterB.push(state.count as number);
        // Processor B never sees Processor A's `charsA` key — state is isolated.
        sawOtherKey.push("charsA" in state);
      },
    };

    await runAgentLoop(
      baseOpts(engine, () => {}, { processors: [procA, procB] }),
    );

    // Each processor's own counter incremented independently across both chunks.
    expect(counterA).toEqual([1, 2]);
    expect(counterB).toEqual([1, 2]);
    // Processor B never observed Processor A's state key.
    expect(sawOtherKey).toEqual([false, false]);
  });

  it("threads the same state object into processOutputResult at run end", async () => {
    let resultText: string | undefined;
    let resultStateCount: number | undefined;
    const processor: Processor = {
      processOutputStream({ part, state }) {
        if (part.type === "text-delta") {
          state.chunks = ((state.chunks as number) ?? 0) + 1;
        }
      },
      processOutputResult({ text, state }) {
        resultText = text;
        resultStateCount = state.chunks as number;
      },
    };

    await runAgentLoop(
      baseOpts(scriptedEngine([textTurn("final answer")]), () => {}, {
        processors: [processor],
      }),
    );

    expect(resultText).toBe("final answer");
    expect(resultStateCount).toBe(1);
  });
});
