import { describe, expect, it } from "vitest";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import {
  EngineError,
  type AgentEngine,
  type EngineEvent,
} from "./engine/types.js";
import { runAgentLoopWithMainChatInternalContinuations } from "./production-agent.js";
import type { AgentChatEvent } from "./types.js";

function stallingAfterToolEngine(): AgentEngine {
  let calls = 0;
  return {
    name: "test",
    label: "Test",
    defaultModel: "test",
    supportedModels: ["test"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(): AsyncIterable<EngineEvent> {
      calls += 1;
      if (calls % 2 === 0) {
        throw new EngineError("Builder gateway request timed out", {
          errorCode: "builder_gateway_timeout",
          providerRetryable: true,
        });
      }
      yield {
        type: "assistant-content",
        parts: [
          {
            type: "tool-call",
            id: `list-${calls}`,
            name: "list-sent-threads",
            input: {},
          },
        ],
      };
      yield { type: "stop", reason: "tool_use" };
    },
  };
}

describe("a run that stops after tool results", () => {
  it("ends with a final message naming what ran and what did not", async () => {
    const actions = loadActionsFromStaticRegistry({
      "list-sent-threads": {
        default: defineAction({
          description: "List sent threads",
          parameters: {},
          readOnly: true,
          run: async () => JSON.stringify({ threads: 14 }),
        }),
      },
    });
    const events: AgentChatEvent[] = [];
    await runAgentLoopWithMainChatInternalContinuations({
      engine: stallingAfterToolEngine(),
      model: "test",
      systemPrompt: "Test",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Draft follow-ups, then verify." }],
        },
      ],
      actions,
      maxContinuations: 2,
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    }).catch(() => undefined);

    const text = events
      .filter((event) => event.type === "text")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(text).toContain("Completed: list-sent-threads.");
    expect(text).not.toContain("Failed:");
    expect(text).toContain("Not done:");
  });

  it("lists a tool that errored under Failed, not Completed", async () => {
    const actions = loadActionsFromStaticRegistry({
      "list-sent-threads": {
        default: defineAction({
          description: "List sent threads",
          parameters: {},
          readOnly: true,
          run: async () => {
            throw new Error("gmail unavailable");
          },
        }),
      },
    });
    const events: AgentChatEvent[] = [];
    await runAgentLoopWithMainChatInternalContinuations({
      engine: stallingAfterToolEngine(),
      model: "test",
      systemPrompt: "Test",
      tools: [],
      messages: [
        { role: "user", content: [{ type: "text", text: "List sent." }] },
      ],
      actions,
      maxContinuations: 2,
      send: (event) => events.push(event),
      signal: new AbortController().signal,
    }).catch(() => undefined);

    const text = events
      .filter((event) => event.type === "text")
      .map((event) => (event as { text: string }).text)
      .join("");
    expect(text).toContain("Failed: list-sent-threads.");
    expect(text).not.toContain("Completed:");
  });
});
