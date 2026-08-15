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
    { type: "text", text: `Turn ${turn}: the rate filter excludes zero rates.` },
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
