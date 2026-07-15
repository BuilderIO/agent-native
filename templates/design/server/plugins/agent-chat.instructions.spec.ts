import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const agentChatSource = readFileSync(
  new URL("./agent-chat.ts", import.meta.url),
  "utf8",
);
const reviewFeedbackSkill = readFileSync(
  new URL(
    "../../.agents/skills/design-review-feedback/SKILL.md",
    import.meta.url,
  ),
  "utf8",
);

describe("design review agent instructions", () => {
  it.each([
    ["agent chat system prompt", agentChatSource],
    ["design-review-feedback skill", reviewFeedbackSkill],
  ])("requires resolution notes in the %s", (_surface, instructions) => {
    expect(instructions).toContain("resolutionNote");
    expect(instructions).toContain("one-line description");
    expect(instructions).toContain("persisted change");
  });
});
