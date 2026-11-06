import { beforeEach, expect, it, vi } from "vitest";

import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
} from "./engine/types.js";
import { withExecutionFence } from "./execution-fence.js";
import type { AgentExecutionStepIntent } from "./run-store.js";
import type { AgentChatEvent } from "./types.js";

const captureErrorMock = vi.hoisted(() => vi.fn());
const recordLateOutcomeMock = vi.hoisted(() =>
  vi.fn(async (_intent: AgentExecutionStepIntent, _resultJson: string) => {}),
);

vi.mock("../server/capture-error.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/capture-error.js")>()),
  captureError: captureErrorMock,
}));

vi.mock("./run-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-store.js")>()),
  getCurrentTurnEventsForThread: vi.fn(async () => []),
  getCompletedAgentExecutionSteps: vi.fn(async () => []),
  beginAgentExecutionStep: vi.fn(async () => ({
    status: "execute" as const,
    wasDispatched: false,
  })),
  markAgentExecutionStepDispatched: vi.fn(async () => {}),
  resetAgentExecutionStepBeforeInvocation: vi.fn(async () => {}),
  markAgentExecutionStepUnknown: vi.fn(async () => {}),
  recordThreadPrivateRun: vi.fn(async () => {}),
  recordLateAgentExecutionStepOutcome: recordLateOutcomeMock,
  completeAgentExecutionStep: vi.fn(async () => {}),
}));

const { runAgentLoop } = await import("./production-agent.js");

const fence = {
  threadId: "durable-thread",
  turnId: "durable-turn",
  runId: "durable-run",
  generation: "7",
};

function engineFor(): AgentEngine {
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
    async *stream(): AsyncIterable<EngineEvent> {
      const parts: EngineContentPart[] =
        streamCall++ === 0
          ? [
              {
                type: "tool-call",
                id: "step-1",
                name: "create-deck",
                input: {},
              },
            ]
          : [{ type: "text", text: "Done." }];
      yield { type: "assistant-content", parts };
      yield {
        type: "stop",
        reason: parts[0]?.type === "tool-call" ? "tool_use" : "end_turn",
      };
    },
  };
}

beforeEach(() => {
  captureErrorMock.mockReset();
  recordLateOutcomeMock.mockReset().mockResolvedValue(undefined);
});

it.each(["upstream refused", "Tool call timed out after 5 seconds"])(
  "reports an on-time rejection normally without late telemetry: %s",
  async (message) => {
    const events: AgentChatEvent[] = [];
    await withExecutionFence(fence, () =>
      runAgentLoop({
        engine: engineFor(),
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
              parameters: { type: "object" as const, properties: {} },
            },
            readOnly: true,
            run: async () => {
              throw new Error(message);
            },
          },
        },
        threadId: fence.threadId,
        turnId: fence.turnId,
        runId: fence.runId,
        send: (event) => events.push(event),
        signal: new AbortController().signal,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_done",
        isError: true,
        result: expect.stringContaining(message),
      }),
    );
    expect(captureErrorMock).not.toHaveBeenCalled();
    expect(recordLateOutcomeMock).not.toHaveBeenCalled();
  },
);
