import { describe, expect, it, vi } from "vitest";

import { createAgentChatAdapter } from "../client/agent-chat-adapter.js";
import { structuredHistoryToEngineMessages } from "./production-agent.js";

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
    for (let userTurns = 20; userTurns < 32; userTurns++) {
      heads.push(await firstHistoryMessage(userTurns));
    }
    expect(heads.every((head) => head && head !== "undefined")).toBe(true);
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
    expect(delivered).toContain("ask number 0");
    expect(delivered).toContain("ask number 12");
    expect(delivered).toContain("ask number 24");
  });
});
