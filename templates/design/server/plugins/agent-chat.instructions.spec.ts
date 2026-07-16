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
const templateAgents = readFileSync(
  new URL("../../AGENTS.md", import.meta.url),
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

describe("select and reprompt agent contract", () => {
  it("keeps the preview-only rule in every always-visible instruction surface", () => {
    expect(agentChatSource).toContain(
      "the design must remain unchanged until the user accepts a preview",
    );
    expect(agentChatSource).toContain('"propose-node-rewrite"');
    expect(agentChatSource).toContain('"resolve-node-rewrite"');
    expect(templateAgents.slice(0, 6_000)).toContain("[Reprompt selection]");
    expect(templateAgents.slice(0, 6_000)).toContain("propose-node-rewrite");
    expect(agentChatSource).toContain("[Selection question]");
    expect(templateAgents.slice(0, 6_000)).toContain("[Selection question]");
  });
});
