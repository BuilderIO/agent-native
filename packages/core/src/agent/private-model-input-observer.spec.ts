import { describe, expect, it } from "vitest";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import type { AgentEngine, EngineMessage } from "./engine/types.js";
import { runAgentLoop } from "./production-agent.js";

describe("private model input observers", () => {
  it.each(["inherited turn", "marked part"] as const)(
    "redacts %s content while leaving the live model input intact",
    async (mode) => {
      const body = "CANARY_PRIVATE_OBSERVER_RESUME_9c2b";
      const captured: unknown[] = [];
      let live = "";
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
        async *stream(options) {
          live = JSON.stringify(options.messages);
          yield {
            type: "assistant-content",
            parts: [{ type: "text", text: "Summary" }],
          };
          yield { type: "stop", reason: "end_turn" };
        },
      };
      await runAgentLoop({
        engine,
        model: "test-model",
        systemPrompt: "Test",
        tools: [],
        actions: {},
        ...(mode === "inherited turn"
          ? { historyPrivacyState: { private: true } }
          : {}),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Public request" },
              {
                type: "text",
                text: body,
                ...(mode === "marked part"
                  ? { omitFromPersistedHistory: true as const }
                  : {}),
              },
            ],
          },
        ],
        signal: new AbortController().signal,
        send: () => {},
        onModelInput: (messages) => {
          captured.push(structuredClone(messages));
        },
      });
      expect(live).toContain(body);
      expect(captured).toHaveLength(1);
      expect(JSON.stringify(captured)).not.toContain(body);
      expect(JSON.stringify(captured)).toContain("[Private content omitted]");
      expect(captured[0]).toEqual([
        expect.objectContaining({
          role: "user",
          content: expect.any(Array),
        }),
      ]);
      if (mode === "marked part")
        expect(JSON.stringify(captured)).toContain("Public request");
    },
  );

  it("keeps a selected private read live for the model without forwarding it to observers", async () => {
    const body = "CANARY_PRIVATE_OBSERVER_BODY_61a9";
    const captured: unknown[] = [];
    const live: EngineMessage[][] = [];
    let calls = 0;
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
      async *stream(options) {
        live.push(structuredClone(options.messages));
        if (calls++ === 0) {
          yield {
            type: "assistant-content",
            parts: [
              {
                type: "tool-call",
                id: "selected-read",
                name: "selected_read",
                input: {},
              },
            ],
          };
          yield { type: "stop", reason: "tool_use" };
        } else {
          yield {
            type: "assistant-content",
            parts: [{ type: "text", text: "Summary" }],
          };
          yield { type: "stop", reason: "end_turn" };
        }
      },
    };
    const action = defineAction({
      description: "Read the explicitly selected item",
      parameters: {},
      readOnly: true,
      persistInChatHistory: false,
      run: async () => body,
    });
    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "Test",
      tools: [],
      actions: loadActionsFromStaticRegistry({
        selected_read: { default: action },
      }),
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Summarize selected item item-1" }],
        },
      ],
      signal: new AbortController().signal,
      send: () => {},
      onModelInput: (messages) => {
        captured.push(structuredClone(messages));
      },
    });
    expect(live).toHaveLength(2);
    expect(JSON.stringify(live[0])).not.toContain(body);
    expect(JSON.stringify(live[1])).toContain(body);
    expect(captured).toHaveLength(2);
    expect(JSON.stringify(captured[0])).toContain("item-1");
    expect(JSON.stringify(captured)).not.toContain(body);
  });
});
