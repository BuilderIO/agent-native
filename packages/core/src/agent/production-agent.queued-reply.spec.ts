import { mockEvent } from "h3";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import * as chatThreadStore from "../chat-threads/store.js";
import { runWithRequestContext } from "../server/request-context.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
  EngineStreamOptions,
} from "./engine/types.js";
import {
  createProductionAgentHandler,
  type ProductionAgentOptions,
} from "./production-agent.js";

const PRIOR_EXCHANGE = [
  {
    message: {
      id: "m-p1",
      role: "user",
      content: [{ type: "text", text: "Fix the corner radius on the card." }],
    },
  },
  {
    message: {
      id: "m-a1",
      role: "assistant",
      content: [{ type: "text", text: "Radius set to 12px." }],
    },
  },
  {
    message: {
      id: "m-p2",
      role: "user",
      content: [
        {
          type: "text",
          text: "Now recreate the shader effect from the reference.",
        },
      ],
    },
  },
];

// The last completed run answered m-a2. The admitted queued prompt is held
// until that reply is in the durable thread.
function durableThread(replyStored: boolean): string {
  return JSON.stringify({
    messages: replyStored
      ? [
          ...PRIOR_EXCHANGE,
          {
            message: {
              id: "m-a2",
              role: "assistant",
              content: [
                { type: "text", text: "Shader recreated with a noise field." },
              ],
            },
          },
        ]
      : PRIOR_EXCHANGE,
    agentKit: {
      runs: [
        {
          id: "run-2",
          status: "completed",
          lastSequence: 9,
          activeMessageId: "m-a2",
        },
      ],
    },
    queuedMessages: [
      {
        id: "queued-p3",
        text: "Does the shader match the reference now?",
        promotionClaim: { id: "claim-p3", expiresAt: Date.now() + 60_000 },
      },
    ],
  });
}

function textOf(message: EngineMessage): string {
  const content = message.content as Array<{ type: string; text?: string }>;
  return content
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n");
}

function promotionRequest(threadId: string): Request {
  return new Request("http://app.example.com/_agent-native/agent-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Does the shader match the reference now?",
      threadId,
      queuedMessageId: "queued-p3",
      queuedMessageClaimId: "claim-p3",
    }),
  });
}

function mockThread(threadId: string, threadData: string) {
  const resolveThreadAccess = vi
    .spyOn(chatThreadStore, "resolveThreadAccess")
    .mockResolvedValue({ id: threadId, threadData } as never);
  const getThread = vi
    .spyOn(chatThreadStore, "getThread")
    .mockResolvedValue({ id: threadId, threadData } as never);
  onTestFinished(() => {
    resolveThreadAccess.mockRestore();
    getThread.mockRestore();
  });
}

function recordingEngine(modelMessages: EngineMessage[][]): AgentEngine {
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
    async *stream(options: EngineStreamOptions): AsyncIterable<EngineEvent> {
      modelMessages.push(options.messages);
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Yes, it matches." }],
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

function handlerFor(engine: AgentEngine) {
  const options: ProductionAgentOptions = {
    systemPrompt: "Test",
    engine,
    actions: {},
    assertAiSetupReady: async () => {},
  };
  return createProductionAgentHandler(options);
}

describe("admitted queued prompt waits for the previous reply", () => {
  it("refuses with a retryable error while the completed reply is not stored", async () => {
    const threadId = "thread-reply-pending";
    mockThread(threadId, durableThread(false));
    const modelCalls: EngineMessage[][] = [];
    const handler = handlerFor(recordingEngine(modelCalls));

    const result = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme", run: {} },
      () => handler(mockEvent(promotionRequest(threadId))),
    );

    expect(result).toMatchObject({
      code: "queued_reply_pending",
      retryable: true,
    });
    expect(modelCalls).toHaveLength(0);
  });

  it("admits the queued prompt with the stored exchange once the reply is stored", async () => {
    const threadId = "thread-reply-stored";
    mockThread(threadId, durableThread(true));
    const modelCalls: EngineMessage[][] = [];
    const handler = handlerFor(recordingEngine(modelCalls));

    const response = await runWithRequestContext(
      { userEmail: "alice@example.com", orgId: "acme", run: {} },
      () => handler(mockEvent(promotionRequest(threadId))),
    );
    if (response instanceof ReadableStream) {
      await new Response(response).text();
    }

    const turn = modelCalls.find((call) =>
      call.some((m) =>
        textOf(m).includes("Does the shader match the reference now?"),
      ),
    );
    expect(turn).toBeDefined();
    expect(turn!.slice(0, -1).map((m) => `${m.role}: ${textOf(m)}`)).toEqual([
      "user: Fix the corner radius on the card.",
      "assistant: Radius set to 12px.",
      "user: Now recreate the shader effect from the reference.",
      "assistant: Shader recreated with a noise field.",
    ]);
  });
});
