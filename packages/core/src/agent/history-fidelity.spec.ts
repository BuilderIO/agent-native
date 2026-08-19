import { describe, expect, it, vi } from "vitest";

import { createAgentChatAdapter } from "../client/agent-chat-adapter.js";
import { structuredHistoryToEngineMessages } from "./production-agent.js";

/**
 * Contract test for the client→server history seam.
 *
 * The client trims history against a size budget and posts `structuredHistory`;
 * the server turns that array into the model's messages. Both halves had unit
 * tests and both passed while production thread 062ab179 sent the model an
 * EMPTY conversation on 8 of 9 follow-up turns — a single tool-heavy assistant
 * turn cost more than the whole budget, so the trimmer dropped every earlier
 * message and the user's own repeated instructions went with it. The agent
 * re-derived the same answer and re-asked the same question ten times.
 *
 * The invariant no layer may coerce away: what the user said reaches the model.
 */

function sseResponse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

/** An assistant turn whose tool results dwarf its prose, as a real read does. */
const toolHeavyTurn = (turn: number, calls: number) => ({
  role: "assistant",
  content: [
    ...Array.from({ length: calls }, (_, i) => ({
      type: "tool-call",
      toolCallId: `t${turn}-c${i}`,
      toolName: "get-extension",
      args: { id: "ext-1", contentQuery: `symbol_${i}` },
      result: "x".repeat(11_000),
    })),
    {
      type: "text",
      text: `Turn ${turn}: the rate filter excludes zero rates.`,
    },
  ],
});

/** The escalation ladder from the production thread, shortened. */
const ASKS = [
  "Why is Walmart not populating in Company-Specific Details?",
  "I just want all companies to populate for all the tabs.",
  "Do the extension fix.",
  "patch the extension. I just want to change the visibility.",
  "I have asked you this several times now. Make this change.",
  "Option B. Do Option B. This is the last time I will ask.",
];

function conversationThrough(askCount: number) {
  const messages: unknown[] = [];
  for (let i = 0; i < askCount; i++) {
    messages.push({ role: "user", content: [{ type: "text", text: ASKS[i] }] });
    if (i < askCount - 1) messages.push(toolHeavyTurn(i, 14));
  }
  return messages;
}

describe("history fidelity: client trim → wire → server engine messages", () => {
  it("delivers every earlier user instruction to the model, on every turn", async () => {
    for (let askCount = 2; askCount <= ASKS.length; askCount++) {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(sseResponse([{ type: "done" }]));
      vi.stubGlobal("fetch", fetchSpy);

      const adapter = createAgentChatAdapter({
        apiUrl: "/_agent-native/agent-chat",
        tabId: `history-fidelity-${askCount}`,
      });

      await drain(
        adapter.run({
          messages: conversationThrough(askCount),
          abortSignal: new AbortController().signal,
        } as any),
      );

      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const engineMessages =
        structuredHistoryToEngineMessages(body.structuredHistory) ?? [];
      const delivered = JSON.stringify(engineMessages);

      // The latest ask travels as `message`, not as history; every ask BEFORE
      // it must survive the trim and the wire conversion.
      for (const earlier of ASKS.slice(0, askCount - 1)) {
        expect(
          delivered,
          `ask ${JSON.stringify(earlier)} was dropped at askCount=${askCount}`,
        ).toContain(earlier);
      }
      expect(body.message).toContain(ASKS[askCount - 1]);
    }
  });

  it("never hands the model an empty conversation mid-thread", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);

    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "history-fidelity-nonempty",
    });

    await drain(
      adapter.run({
        messages: [
          { role: "user", content: [{ type: "text", text: ASKS[0] }] },
          // One turn that alone costs several times the whole budget.
          toolHeavyTurn(0, 40),
          { role: "user", content: [{ type: "text", text: ASKS[1] }] },
        ],
        abortSignal: new AbortController().signal,
      } as any),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.structuredHistory.length).toBeGreaterThan(0);
    expect(structuredHistoryToEngineMessages(body.structuredHistory)).not.toBe(
      null,
    );
  });
});

/**
 * A prompt cache matches a byte-identical prefix. The trimmer's window ends at
 * the newest message, so if its START moves every turn the first bytes of the
 * conversation change every turn and nothing is ever a cache hit — the exact
 * "moving window invalidates cache-hit" failure. The window start is quantized
 * so it only moves once per stride; a plain `slice(-MAX)` makes the count below
 * equal the number of turns.
 */
describe("history fidelity: the replayed prefix is stable across turns", () => {
  const shortTurns = (userTurns: number) => {
    const messages: unknown[] = [];
    for (let i = 0; i < userTurns; i++) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: `ask ${i}` }],
      });
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: `answer ${i}` }],
      });
    }
    // The turn being sent now: its user message travels as `message`.
    messages.push({
      role: "user",
      content: [{ type: "text", text: "latest ask" }],
    });
    return messages;
  };

  async function firstHistoryMessage(userTurns: number) {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: `prefix-stability-${userTurns}`,
    });
    await drain(
      adapter.run({
        messages: shortTurns(userTurns),
        abortSignal: new AbortController().signal,
      } as any),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    return JSON.stringify(body.structuredHistory[0]);
  }

  it("moves the window start once per stride, not once per turn", async () => {
    const heads: string[] = [];
    // 12 consecutive turns, all well past the message cap.
    for (let userTurns = 20; userTurns < 32; userTurns++) {
      heads.push(await firstHistoryMessage(userTurns));
    }
    expect(heads.every((head) => head && head !== "undefined")).toBe(true);
    // One distinct prefix per stride block. A window that slides every turn
    // yields 12 — one full cache write per turn for the whole conversation.
    expect(new Set(heads).size).toBeLessThanOrEqual(4);
  });

  it("still ends on the most recent completed turn", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "prefix-stability-recency",
    });
    await drain(
      adapter.run({
        messages: shortTurns(20),
        abortSignal: new AbortController().signal,
      } as any),
    );
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(JSON.stringify(body.structuredHistory)).toContain("answer 19");
  });
});
/**
 * Reducing a long thread belongs to Observational Memory, which cannot help
 * with turns the client already dropped before the request left the browser.
 * The message-count cap is a backstop; what a request carries is bounded by the
 * char budgets, so short asks keep surviving far past the old cap of 24.
 */
describe("history fidelity: user asks survive past the old message cap", () => {
  it("keeps asks from well beyond 24 messages back", async () => {
    const messages: unknown[] = [];
    for (let i = 0; i < 25; i++) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: `ask number ${i}` }],
      });
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: `answer number ${i}` }],
      });
    }
    messages.push({
      role: "user",
      content: [{ type: "text", text: "latest ask" }],
    });

    const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
    vi.stubGlobal("fetch", fetchSpy);
    const adapter = createAgentChatAdapter({
      apiUrl: "/_agent-native/agent-chat",
      tabId: "beyond-old-cap",
    });
    await drain(
      adapter.run({
        messages,
        abortSignal: new AbortController().signal,
      } as any),
    );

    const delivered = JSON.stringify(
      JSON.parse(fetchSpy.mock.calls[0][1].body).structuredHistory,
    );
    // 50 prior messages of prose fit the word budget, so none of these asks
    // should have been evicted by a message count.
    expect(delivered).toContain("ask number 0");
    expect(delivered).toContain("ask number 12");
    expect(delivered).toContain("ask number 24");
  });
});
