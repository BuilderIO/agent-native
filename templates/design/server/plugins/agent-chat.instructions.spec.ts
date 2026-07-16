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
const designTemplateSkill = readFileSync(
  new URL("../../.agents/skills/design-templates/SKILL.md", import.meta.url),
  "utf8",
);
const designAgentGuide = readFileSync(
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

describe("design template agent instructions", () => {
  it.each([
    ["agent chat system prompt", agentChatSource],
    ["design-templates skill", designTemplateSkill],
    ["Design AGENTS guide", designAgentGuide],
  ])(
    "uses the main action surface and resolves templates or prior designs in the %s",
    (_surface, instructions) => {
      expect(instructions).toContain("list-design-templates");
      expect(instructions).toContain("list-designs");
      expect(instructions).toContain("create-design-from-template");
      expect(instructions).toContain("get-design-snapshot");
      expect(instructions).toContain("edit-design");
      expect(instructions).not.toMatch(/`list-templates`/);
      expect(instructions).not.toMatch(/`save-as-template`/);
    },
  );
});
