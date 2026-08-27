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
  it("preserves the exact new-deck prompt", () => {
    expect(longMultilinePrompt.length).toBeGreaterThan(180);
    const prompt = `  ${longMultilinePrompt}\n`;
    expect(createDeckAgentMessage(prompt)).toBe(prompt);
  });

  it("preserves the exact multiline add-slide prompt", () => {
    const prompt = `\n${longMultilinePrompt}  `;
    expect(addSlideAgentMessage(prompt)).toBe(prompt);
  });

  it("uses a fallback only when no prompt was entered", () => {
    expect(createDeckAgentMessage("")).toBe("new deck");
    expect(addSlideAgentMessage("")).toBe("a new slide");
  });

  it("bounds oversized prompts without adding an action prefix", () => {
    const prompt = "x".repeat(MAX_AGENT_VISIBLE_MESSAGE_CHARS + 1_000);
    const message = createDeckAgentMessage(prompt);

    expect(message).toHaveLength(MAX_AGENT_VISIBLE_MESSAGE_CHARS);
    expect(message).toContain("[Prompt truncated for reliability]");
    expect(message).toMatch(/^x+/);
  });
});
