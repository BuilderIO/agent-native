import { describe, expect, it } from "vitest";

import { defineAction } from "../action.js";
import { loadActionsFromStaticRegistry } from "../server/action-discovery.js";
import {
  EngineError,
  type AgentEngine,
  type EngineMessage,
  type EngineEvent,
  type EngineStreamOptions,
} from "./engine/types.js";
import { runAgentLoop } from "./production-agent.js";
import { runAgentLoopDirectWithSoftTimeout } from "./run-loop-with-resume.js";

const BASE_CAPABILITIES = {
  thinking: false,
  promptCaching: false,
  vision: false,
  computerUse: false,
  parallelToolCalls: false,
};

function makeEngine(
  onStream: (options: EngineStreamOptions) => AsyncGenerator<EngineEvent>,
): AgentEngine {
  return {
    name: "test",
    label: "Test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
    supportsPrivateContent: true,
    capabilities: { ...BASE_CAPABILITIES },
    stream: onStream,
  };
}

describe("private content model dispatch flag", () => {
  it("leaves an ordinary initial dispatch without its own privateContent key", async () => {
    const seen: Array<{ hasOwn: boolean; value: unknown }> = [];
    const engine = makeEngine(async function* (options) {
      seen.push({
        hasOwn: Object.prototype.hasOwnProperty.call(options, "privateContent"),
        value: options.privateContent,
      });
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Hello" }],
      };
      yield { type: "stop", reason: "end_turn" };
    });

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "Test",
      tools: [],
      actions: {},
      messages: [
        { role: "user", content: [{ type: "text", text: "Public request" }] },
      ],
      signal: new AbortController().signal,
      send: () => {},
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.hasOwn).toBe(false);
    expect(seen[0]?.value).toBeUndefined();
  });

  it("forwards privateContent:true on the dispatch after a selected private read", async () => {
    const body = "CANARY_PRIVATE_DISPATCH_BODY_4f7a";
    const seen: Array<{ hasOwn: boolean; value: unknown }> = [];
    const live: EngineMessage[][] = [];
    let calls = 0;
    const engine = makeEngine(async function* (options) {
      seen.push({
        hasOwn: Object.prototype.hasOwnProperty.call(options, "privateContent"),
        value: options.privateContent,
      });
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
    });
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
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]?.hasOwn).toBe(false);
    expect(seen[1]?.hasOwn).toBe(true);
    expect(seen[1]?.value).toBe(true);
    expect(JSON.stringify(live[0])).not.toContain(body);
    expect(JSON.stringify(live[1])).toContain(body);
  });

  it("forwards privateContent:true on the first dispatch of an inherited private turn", async () => {
    const seen: Array<{ hasOwn: boolean; value: unknown }> = [];
    const engine = makeEngine(async function* (options) {
      seen.push({
        hasOwn: Object.prototype.hasOwnProperty.call(options, "privateContent"),
        value: options.privateContent,
      });
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Summary" }],
      };
      yield { type: "stop", reason: "end_turn" };
    });

    await runAgentLoop({
      engine,
      model: "test-model",
      systemPrompt: "Test",
      tools: [],
      actions: {},
      historyPrivacyState: { private: true },
      messages: [
        { role: "user", content: [{ type: "text", text: "Private request" }] },
      ],
      signal: new AbortController().signal,
      send: () => {},
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.hasOwn).toBe(true);
    expect(seen[0]?.value).toBe(true);
  });

  it("keeps privateContent:true after a resumable soft continuation", async () => {
    const body = "CANARY_PRIVATE_DISPATCH_RESUME_1c93";
    const seen: Array<{ hasOwn: boolean; value: unknown }> = [];
    let calls = 0;
    const engine = makeEngine(async function* (options) {
      seen.push({
        hasOwn: Object.prototype.hasOwnProperty.call(options, "privateContent"),
        value: options.privateContent,
      });
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
        return;
      }
      if (calls === 2) {
        throw new EngineError("Builder gateway timed out", {
          errorCode: "builder_gateway_timeout",
        });
      }
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text: "Summary" }],
      };
      yield { type: "stop", reason: "end_turn" };
    });
    const action = defineAction({
      description: "Read the explicitly selected item",
      parameters: {},
      readOnly: true,
      persistInChatHistory: false,
      run: async () => body,
    });
    const messages: EngineMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Summarize selected item item-1" }],
      },
    ];

    await runAgentLoopDirectWithSoftTimeout(
      {
        engine,
        model: "test-model",
        systemPrompt: "Test",
        tools: [],
        actions: loadActionsFromStaticRegistry({
          selected_read: { default: action },
        }),
        messages,
        signal: new AbortController().signal,
        send: () => {},
      },
      60_000,
    );

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.at(-1)?.hasOwn).toBe(true);
    expect(seen.at(-1)?.value).toBe(true);
  });
});
