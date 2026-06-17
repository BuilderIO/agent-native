import { describe, expectTypeOf, it } from "vitest";
import type {
  AgentChatRuntime,
  AgentChatRuntimeEvent,
  AgentChatRuntimeKnownEvent,
  AgentChatRuntimeMessage,
  AgentChatRuntimeToolCall,
  AgentChatRuntimeTurn,
} from "./runtime.js";
import type { AgentChatRuntime as AgentChatRuntimeFromChatBarrel } from "./index.js";
import type { AgentChatRuntime as AgentChatRuntimeFromClientBarrel } from "../index.js";

async function* streamRuntimeEvents(): AsyncIterable<AgentChatRuntimeEvent> {
  yield {
    type: "message-start",
    message: { id: "message-1", role: "assistant", content: [] },
  };
  yield {
    type: "message-delta",
    messageId: "message-1",
    delta: { type: "text", text: "Hello" },
  };
  yield {
    type: "tool-start",
    toolCall: { id: "tool-1", name: "search", input: { q: "docs" } },
  };
  yield {
    type: "tool-done",
    toolCallId: "tool-1",
    toolName: "search",
    status: "completed",
    resultText: "Found docs",
  };
  yield { type: "done", reason: "complete" };
}

describe("AgentChatRuntime types", () => {
  it("describe an external runtime with sessions, streaming, tools, and cancellation", () => {
    const runtime: AgentChatRuntime = {
      id: "external:mastra",
      kind: "external-agent",
      label: "Mastra",
      capabilities: {
        messages: {
          streaming: true,
          history: true,
          structuredContent: true,
          attachments: true,
        },
        tools: {
          events: true,
          hostTools: true,
          inputStreaming: true,
          resultStreaming: true,
        },
        sessions: {
          create: true,
          restore: true,
          persistent: true,
        },
        cancellation: {
          abortSignal: true,
          explicitCancel: true,
          interrupt: true,
        },
      },
      async createSession(input) {
        const sessionId = input?.id ?? "session-1";
        return {
          id: sessionId,
          runtimeId: "external:mastra",
          startTurn(): AgentChatRuntimeTurn {
            return {
              id: "turn-1",
              sessionId,
              events: streamRuntimeEvents(),
              cancel: async () => ({ status: "cancelled" }),
            };
          },
          cancelTurn: async () => ({ status: "cancelled" }),
        };
      },
    };

    expectTypeOf(runtime).toMatchTypeOf<AgentChatRuntime>();
    expectTypeOf(runtime.createSession).parameters.toEqualTypeOf<
      [input?: Parameters<AgentChatRuntime["createSession"]>[0]]
    >();
  });

  it("keeps normalized event and message shapes discriminated", () => {
    expectTypeOf<
      Extract<AgentChatRuntimeEvent, { type: "tool-start" }>["toolCall"]
    >().toEqualTypeOf<AgentChatRuntimeToolCall>();
    expectTypeOf<
      Extract<AgentChatRuntimeEvent, { type: "message-done" }>["message"]
    >().toEqualTypeOf<AgentChatRuntimeMessage>();
    expectTypeOf<AgentChatRuntimeKnownEvent>().toMatchTypeOf<AgentChatRuntimeEvent>();
  });

  it("exports the runtime contract from client barrels", () => {
    expectTypeOf<AgentChatRuntimeFromChatBarrel>().toEqualTypeOf<AgentChatRuntime>();
    expectTypeOf<AgentChatRuntimeFromClientBarrel>().toEqualTypeOf<AgentChatRuntime>();
  });
});
