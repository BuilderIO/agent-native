import { describe, expect, it } from "vitest";

import {
  repairSlackFeedbackPrompt,
  SLACK_HANDOFF_INSTRUCTION,
  SLACK_MENTION_GUARD,
} from "./slack-feedback-prompt.js";

const obsoleteParagraph = `The Builder reply must tag @builder.io with the dot and tell it to run
/address-feedback. It must point Builder to the relevant repository skills,
the representative source, every related source, and the need to fix the
underlying boundary across the whole cluster. Never add the reaction or tag
Builder for owner-managed Clips, Design, and Content work, or for a non-bug
report.`;

describe("repairSlackFeedbackPrompt", () => {
  it("replaces the obsolete tag-@builder.io paragraph even when the new guard is already appended", () => {
    const existing = `# Factory Slack feedback triage

${obsoleteParagraph}

${SLACK_MENTION_GUARD}
`;

    const repaired = repairSlackFeedbackPrompt(existing);

    expect(repaired).toContain(SLACK_HANDOFF_INSTRUCTION);
    expect(repaired).toContain(SLACK_MENTION_GUARD);
    expect(repaired).not.toMatch(/tag @builder\.io/i);
    expect(repaired.match(new RegExp(SLACK_MENTION_GUARD, "g"))).toHaveLength(
      1,
    );
  });

  it("appends the mention guard when repairing a prompt that only has the obsolete paragraph", () => {
    const repaired = repairSlackFeedbackPrompt(obsoleteParagraph);

    expect(repaired).toContain(SLACK_HANDOFF_INSTRUCTION);
    expect(repaired).toContain(SLACK_MENTION_GUARD);
    expect(repaired).not.toMatch(/tag @builder\.io/i);
  });
});
