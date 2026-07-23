import { describe, expect, it } from "vitest";

import {
  addSlideAgentMessage,
  createDeckAgentMessage,
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
});
