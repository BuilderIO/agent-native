import type { WriteReceipt } from "@agent-native/core/action";
import {
  runAgentLoop,
  type ActionEntry,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../.generated/actions-registry.js", () => ({
  default: {
    bigquery: {
      readOnly: true,
      grounding: true,
      tool: {
        description: "Query BigQuery",
        parameters: { type: "object", properties: {} },
      },
      run: async () => "ok",
    },
  },
}));

import { realDataFinalGuard } from "./agent-chat";

// A turn the template guard cannot see: its request text is neither a data
// request nor a dashboard construction request.
const PUSHBACK = "The line is not on the chart after I refresh";
const CLAIM = "Fixed. Refresh and the rolling-average line is on the chart.";

const UNVERIFIED: WriteReceipt = {
  changed: true,
  verified: false,
  summary:
    'Saved 1 op(s) to "growth" but NOT verified: "Signups by app" its data source is not connected.',
};

function mutateDashboard(receipt: WriteReceipt): ActionEntry {
  return {
    tool: {
      description: "Edits a dashboard",
      parameters: { type: "object", properties: {} },
    },
    readOnly: false,
    run: async () => ({ saved: true, _receipt: receipt }),
  };
}

async function runPushbackTurn(receipt: WriteReceipt) {
  const seenMessages: string[] = [];
  let streamCalls = 0;
  const turns: Array<
    Array<
      | { type: "tool-call"; id: string; name: string; input: object }
      | { type: "text"; text: string }
    >
  > = [
    [{ type: "tool-call", id: "m1", name: "mutate-dashboard", input: {} }],
    [{ type: "text", text: CLAIM }],
    [{ type: "text", text: "Saved, but I could not verify the panel." }],
  ];
  await runAgentLoop({
    engine: {
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
      async *stream(opts) {
        seenMessages.push(JSON.stringify(opts.messages));
        const parts = turns[streamCalls++] ?? [{ type: "text", text: "done" }];
        yield { type: "assistant-content", parts };
        yield {
          type: "stop",
          reason: parts.some((part) => part.type === "tool-call")
            ? "tool_use"
            : "end_turn",
        };
      },
    },
    model: "test-model",
    systemPrompt: "system",
    tools: [],
    messages: [{ role: "user", content: [{ type: "text", text: PUSHBACK }] }],
    actions: { "mutate-dashboard": mutateDashboard(receipt) },
    send: () => {},
    signal: new AbortController().signal,
    finalResponseGuard: realDataFinalGuard,
  });
  return { seenMessages, streamCalls };
}

describe("analytics pushback turns and write receipts", () => {
  it("the template guard alone is inert on a pushback turn", () => {
    const context: AgentLoopFinalResponseGuardContext = {
      messages: [{ role: "user", content: [{ type: "text", text: PUSHBACK }] }],
      requestText: PUSHBACK,
      assistantContent: [],
      text: CLAIM,
      toolCalls: [],
      toolResults: [
        {
          name: "mutate-dashboard",
          isError: false,
          content: "{}",
          receipt: UNVERIFIED,
        },
      ],
      retryCount: 0,
      executionMode: "act",
    };

    expect(realDataFinalGuard(context)).toBeNull();
  });

  it("retries a pushback turn whose mutate-dashboard write is verified:false", async () => {
    const { seenMessages, streamCalls } = await runPushbackTurn(UNVERIFIED);

    expect(streamCalls).toBe(3);
    expect(seenMessages[2]).toContain("<write-receipts>");
    expect(seenMessages[2]).toContain("verified=false");
    expect(seenMessages[2]).toContain("its data source is not connected");
  });

  it("does not retry the same turn when the write is verified:true", async () => {
    const { streamCalls } = await runPushbackTurn({
      changed: true,
      verified: true,
      summary: 'Saved 1 op(s) to "growth"; 1 panel(s) verified rendering.',
    });

    expect(streamCalls).toBe(2);
  });
});
