import { describe, expect, it } from "vitest";

import type { WriteReceipt } from "../action.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import {
  runAgentLoop,
  type ActionEntry,
  type AgentLoopFinalResponseGuard,
  type AgentLoopFinalResponseGuardContext,
} from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

const toolCall = (): EngineContentPart => ({
  type: "tool-call",
  id: "write-1",
  name: "write-thing",
  input: {},
});

const text = (value: string): EngineContentPart => ({
  type: "text",
  text: value,
});

function writeAction(
  result: unknown,
  extra: Partial<ActionEntry> = {},
): ActionEntry {
  return {
    tool: {
      description: "Writes a thing",
      parameters: { type: "object", properties: {} },
    },
    readOnly: false,
    run: async () => result,
    ...extra,
  };
}

async function run(opts: {
  turns: EngineContentPart[][];
  action: ActionEntry;
  guard?: AgentLoopFinalResponseGuard;
}) {
  const events: AgentChatEvent[] = [];
  const seenMessages: string[] = [];
  let streamCalls = 0;
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
    async *stream(streamOpts): AsyncIterable<EngineEvent> {
      seenMessages.push(JSON.stringify(streamOpts.messages));
      const parts = opts.turns[streamCalls++] ?? [text("(script exhausted)")];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts.some((part) => part.type === "tool-call")
          ? "tool_use"
          : "end_turn",
      };
    },
  };
  const usage = await runAgentLoop({
    engine,
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
    actions: { "write-thing": opts.action },
    send: (event) => events.push(event),
    signal: new AbortController().signal,
    finalResponseGuard: opts.guard,
  });
  return {
    usage,
    seenMessages,
    streamCalls: () => streamCalls,
    texts: events.flatMap((event) =>
      event.type === "text" ? [event.text] : [],
    ),
    toolDone: events.find((event) => event.type === "tool_done") as
      | (AgentChatEvent & { completedSideEffect?: boolean })
      | undefined,
  };
}

const unverifiedWrite: WriteReceipt = {
  changed: true,
  verified: false,
  summary: "Saved; the panel was not checked.",
};

describe("write receipts in the agent loop", () => {
  it("retries once with the receipt block when a write is verified:false", async () => {
    const result = await run({
      turns: [
        [toolCall()],
        [text("The chart now shows the line.")],
        [text("Saved, but not verified.")],
      ],
      action: writeAction({ saved: true, _receipt: unverifiedWrite }),
    });

    expect(result.streamCalls()).toBe(3);
    expect(result.seenMessages[2]).toContain("<write-receipts>");
    expect(result.seenMessages[2]).toContain("verified=false");
    expect(result.seenMessages[2]).toContain(
      "Saved; the panel was not checked.",
    );
    expect(result.seenMessages[2]).toContain(
      "Do not say a change is visible or working unless verified=true.",
    );
  });

  it("prefixes the receipt block to the answer once the one retry is spent", async () => {
    const result = await run({
      turns: [[toolCall()], [text("It is done.")], [text("It is still done.")]],
      action: writeAction({ _receipt: unverifiedWrite }),
    });

    expect(result.streamCalls()).toBe(3);
    expect(result.texts.at(-1)).toBe(
      "Write check:\n- write-thing: changed=true verified=false. Saved; the panel was not checked.\n\nIt is still done.",
    );
  });

  it("allows only one receipt retry per turn even if the model writes again", async () => {
    const result = await run({
      turns: [
        [toolCall()],
        [text("Done.")],
        [toolCall()],
        [text("Done again.")],
      ],
      action: writeAction({ _receipt: unverifiedWrite }),
    });

    expect(result.streamCalls()).toBe(4);
    expect(result.texts.at(-1)).toMatch(/^Write check:\n/);
    expect(result.texts.at(-1)).toMatch(/Done again\.$/);
  });

  it("does not retry or annotate a clean verified:true write", async () => {
    const result = await run({
      turns: [[toolCall()], [text("Updated and checked.")]],
      action: writeAction({
        _receipt: {
          changed: true,
          verified: true,
          summary: "Saved and checked.",
        },
      }),
    });

    expect(result.streamCalls()).toBe(2);
    expect(result.texts).toEqual(["Updated and checked."]);
    expect(result.usage.receiptUnverifiedCount).toBeUndefined();
    expect(result.usage.receiptChangedFalseCount).toBeUndefined();
  });

  it("only annotates, never retries, when the receipt is merely unverified", async () => {
    const result = await run({
      turns: [[toolCall()], [text("Saved it.")]],
      action: writeAction({
        _receipt: {
          changed: true,
          verified: "unverified",
          summary: "Could not check.",
        },
      }),
    });

    expect(result.streamCalls()).toBe(2);
    expect(result.texts.at(-1)).toBe(
      "Write check:\n- write-thing: changed=true verified=unverified. Could not check.\n\nSaved it.",
    );
  });

  it("keeps the receipt when the result is truncated before the model sees it", async () => {
    const result = await run({
      turns: [[toolCall()], [text("Done.")], [text("Not verified.")]],
      action: writeAction(
        { rows: "x".repeat(5_000), _receipt: unverifiedWrite },
        { maxResultChars: 100 },
      ),
    });

    expect(result.streamCalls()).toBe(3);
    expect(result.seenMessages[1]).toContain("truncated");
    expect(result.seenMessages[1]).not.toContain(
      "Saved; the panel was not checked.",
    );
    expect(result.seenMessages[2]).toContain(
      "Saved; the panel was not checked.",
    );
  });

  it("treats a malformed receipt as unverified instead of clean", async () => {
    const result = await run({
      turns: [[toolCall()], [text("Saved.")]],
      action: writeAction({ _receipt: { changed: "yes" } }),
    });

    expect(result.streamCalls()).toBe(2);
    expect(result.texts.at(-1)).toContain(
      "verified=unverified. malformed receipt",
    );
    expect(result.toolDone?.completedSideEffect).toBe(true);
    expect(result.usage.receiptUnverifiedCount).toBe(1);
  });

  it("reports completedSideEffect from the receipt, and counts the cases", async () => {
    const noop = await run({
      turns: [
        [toolCall()],
        [text("Nothing changed.")],
        [text("No change was made.")],
      ],
      action: writeAction({
        _receipt: {
          changed: false,
          verified: true,
          summary: "Already had that config.",
        },
      }),
    });
    expect(noop.toolDone?.completedSideEffect).toBe(false);
    expect(noop.streamCalls()).toBe(3);
    expect(noop.usage.receiptChangedFalseCount).toBe(1);
    expect(noop.usage.receiptUnverifiedCount).toBeUndefined();

    const written = await run({
      turns: [[toolCall()], [text("Saved.")]],
      action: writeAction({
        _receipt: { changed: true, verified: true, summary: "Saved." },
      }),
    });
    expect(written.toolDone?.completedSideEffect).toBe(true);
  });

  it("leaves actions without a receipt exactly as before", async () => {
    const result = await run({
      turns: [[toolCall()], [text("Saved.")]],
      action: writeAction({ saved: false }),
    });

    expect(result.streamCalls()).toBe(2);
    expect(result.toolDone?.completedSideEffect).toBe(true);
    expect(result.texts).toEqual(["Saved."]);
  });

  it("hands the receipts to the app guard and shares the retry with it", async () => {
    const seen: AgentLoopFinalResponseGuardContext["receipts"][] = [];
    const result = await run({
      turns: [[toolCall()], [text("Done.")], [text("Reworded.")]],
      action: writeAction({ _receipt: unverifiedWrite }),
      guard: (ctx) => {
        seen.push(ctx.receipts);
        return ctx.retryCount === 0
          ? { retryMessage: "Ground the number.", maxRetries: 1 }
          : null;
      },
    });

    expect(seen[0]).toEqual([{ tool: "write-thing", ...unverifiedWrite }]);
    expect(result.streamCalls()).toBe(3);
    expect(result.seenMessages[2]).toContain("<write-receipts>");
    expect(result.seenMessages[2]).toContain("Ground the number.");
  });
});
