import { describe, expect, it } from "vitest";

import {
  addSlideAgentMessage,
  createDeckAgentMessage,
  MAX_AGENT_VISIBLE_MESSAGE_CHARS,
} from "./agent-visible-message";

const longMultilinePrompt = [
  "Build an executive account review using the latest usage, adoption, and contract data.",
  "Call out the strongest expansion signals, current blockers, named owners, and the decisions needed before the customer meeting.",
].join("\n");

describe("visible Slides agent messages", () => {
  it("preserves the full trimmed new-deck prompt beyond 180 characters", () => {
    expect(longMultilinePrompt.length).toBeGreaterThan(180);
    expect(createDeckAgentMessage(`  ${longMultilinePrompt}\n`)).toBe(
      `Create deck: ${longMultilinePrompt}`,
    );
  });

  it("preserves the full trimmed multiline add-slide prompt", () => {
    expect(addSlideAgentMessage(`\n${longMultilinePrompt}  `)).toBe(
      `Add slide: ${longMultilinePrompt}`,
    );
  });

  it("bounds oversized prompts while keeping a truncation marker", () => {
    const prompt = "x".repeat(MAX_AGENT_VISIBLE_MESSAGE_CHARS + 1_000);
    const message = createDeckAgentMessage(prompt);

    expect(message).toHaveLength(MAX_AGENT_VISIBLE_MESSAGE_CHARS);
    expect(message).toContain("[Prompt truncated for reliability]");
    expect(message).toMatch(/^Create deck: x+/);
  });
});
