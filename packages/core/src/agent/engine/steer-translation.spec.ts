import { describe, expect, it } from "vitest";

import { engineMessagesToAISDK } from "./translate-ai-sdk.js";
import {
  engineMessagesToAnthropic,
  engineMessagesToBuilderGatewayAnthropic,
} from "./translate-anthropic.js";
import type { EngineMessage } from "./types.js";

// Send now appends the user's text to the user message that carries the tool
// results. Every engine family must keep both, results first.
const messages: EngineMessage[] = [
  { role: "user", content: [{ type: "text", text: "Fix the deck" }] },
  {
    role: "assistant",
    content: [
      { type: "tool-call", id: "call-1", name: "read-deck", input: {} },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "read-deck",
        content: "3 slides",
      },
      { type: "text", text: "Use the blue theme" },
    ],
  },
];

describe("a message sent into a run, per engine", () => {
  it("Anthropic reads the text block after the tool result", () => {
    for (const translated of [
      engineMessagesToAnthropic(messages),
      engineMessagesToBuilderGatewayAnthropic(messages),
    ]) {
      const last = translated.at(-1)!;
      expect(last.role).toBe("user");
      expect(
        (last.content as Array<{ type: string; text?: string }>).map(
          (block) => [block.type, block.text],
        ),
      ).toEqual([
        ["tool_result", undefined],
        ["text", "Use the blue theme"],
      ]);
    }
  });

  it("AI SDK engines send the tool result, then the user's text", () => {
    const translated = engineMessagesToAISDK(messages);

    expect(translated.slice(-2)).toEqual([
      {
        role: "tool",
        content: [
          expect.objectContaining({
            type: "tool-result",
            toolCallId: "call-1",
          }),
        ],
      },
      { role: "user", content: "Use the blue theme" },
    ]);
  });
});
