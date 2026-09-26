import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentChatAdapter } from "./agent-chat-adapter.js";
import { appendAgentChatContextToMessage } from "./agent-chat.js";
import {
  formatGuidedAnswersForAgent,
  type GuidedQuestion,
} from "./guided-questions.js";

const GRAIN = "What time grain should the dashboard use?";
const EXCLUSIONS = "Which orgs should be excluded?";

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body.join("")));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream", "x-run-id": "run-loop" },
    },
  );
}

function question(text: string): GuidedQuestion {
  return { id: "q1", type: "text-options", question: text };
}

describe("appendAgentChatContextToMessage", () => {
  it("preserves the visible message while appending hidden context", () => {
    expect(
      appendAgentChatContextToMessage("  Make this deck  ", "Hidden context"),
    ).toBe("  Make this deck  \n\n<context>\nHidden context\n</context>");
  });
});

function askTurn(id: string, text: string) {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: id,
        toolName: "ask-question",
        argsText: JSON.stringify({ question: text }),
        args: { question: text },
        result:
          "Asked the user a clarifying question and rendered it in the chat.",
      },
    ],
  };
}

function answerTurn(text: string, answer: string) {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: appendAgentChatContextToMessage(
          "Here are my answers — go ahead.",
          [
            "The user answered the guided questions.",
            "Treat every question below as settled: do not ask it again.",
            "",
            "Answers:",
            formatGuidedAnswersForAgent({ q1: answer }, [question(text)]),
          ].join("\n"),
        ),
      },
    ],
  };
}

function toolHeavyTurn(index: number) {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: `tc-${index}`,
        toolName: "run-code",
        argsText: JSON.stringify({ sql: "select * from events" }),
        args: { sql: "select * from events" },
        result: "row,".repeat(6_000),
      },
    ],
  };
}

async function requestedHistory(messages: unknown[]) {
  const fetchSpy = vi.fn().mockResolvedValue(sseResponse([{ type: "done" }]));
  vi.stubGlobal("fetch", fetchSpy);
  const adapter = createAgentChatAdapter({
    apiUrl: "/_agent-native/agent-chat",
    tabId: "chat-loop",
    threadId: "thread-loop",
  });
  for await (const _ of adapter.run({
    messages,
    abortSignal: new AbortController().signal,
  }) as any) {
    // drain
  }
  const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
  return (body.structuredHistory ?? []) as {
    role: string;
    content: { type: string; text?: string }[];
  }[];
}

function messagesMentioning(
  history: Awaited<ReturnType<typeof requestedHistory>>,
  answer: string,
): string[] {
  return history
    .map((message) =>
      (message.content ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("\n"),
    )
    .filter((text) => text.includes(answer));
}

describe("answered clarifications survive history trimming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps question and answer in one message through a tool-heavy thread", async () => {
    const messages: unknown[] = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Build an account engagement effort dashboard.",
          },
        ],
      },
      askTurn("ask-1", GRAIN),
      answerTurn(GRAIN, "Weekly"),
    ];
    for (let i = 0; i < 12; i += 1) {
      messages.push(toolHeavyTurn(i));
      messages.push({
        role: "user",
        content: [{ type: "text", text: `Keep going (${i}).` }],
      });
    }

    const history = await requestedHistory(messages);
    const carriers = messagesMentioning(history, "Weekly");

    expect(carriers.length).toBeGreaterThan(0);
    expect(carriers.some((text) => text.includes(GRAIN))).toBe(true);
  });

  it("keeps two answers that share an id distinguishable", async () => {
    const history = await requestedHistory([
      { role: "user", content: [{ type: "text", text: "Build it." }] },
      askTurn("ask-1", GRAIN),
      answerTurn(GRAIN, "Weekly"),
      askTurn("ask-2", EXCLUSIONS),
      answerTurn(EXCLUSIONS, "Internal orgs"),
      { role: "user", content: [{ type: "text", text: "Go." }] },
    ]);

    expect(messagesMentioning(history, "Weekly")[0]).toContain(GRAIN);
    expect(messagesMentioning(history, "Internal orgs")[0]).toContain(
      EXCLUSIONS,
    );
    expect(JSON.stringify(history)).not.toContain("q1: ");
  });
});
