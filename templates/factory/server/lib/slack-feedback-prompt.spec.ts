import { describe, expect, it } from "vitest";

import { repairSlackFeedbackPrompt } from "./slack-feedback-prompt.js";

const obsoleteParagraph = `The Builder reply must tag @builder.io with the dot and tell it to run
/address-feedback. It must point Builder to the relevant repository skills,
the representative source, every related source, and the need to fix the
underlying boundary across the whole cluster. Never add the reaction or tag
Builder for owner-managed Clips, Design, and Content work, or for a non-bug
report.`;

const pastedMentionGuard =
  "Never post Slack messages, reactions, or plaintext @handles yourself. Call dispatch-factory-item; that action pings Builder with a Slack user id. Plaintext @builder.io does not notify anyone.";

describe("repairSlackFeedbackPrompt", () => {
  it("removes the obsolete tag-@builder.io paragraph and pasted mention guard", () => {
    const existing = `# Factory Slack feedback triage

${obsoleteParagraph}

${pastedMentionGuard}
`;

    const repaired = repairSlackFeedbackPrompt(existing);

    expect(repaired).toContain("# Factory Slack feedback triage");
    expect(repaired).not.toContain(pastedMentionGuard);
    expect(repaired).not.toMatch(/tag @builder\.io/i);
    expect(repaired).not.toContain("that action adds 👀");
  });

  it("does not append mention or skip copy into the user prompt", () => {
    const repaired = repairSlackFeedbackPrompt(obsoleteParagraph);

    expect(repaired).not.toContain(pastedMentionGuard);
    expect(repaired).not.toMatch(/tag @builder\.io/i);
    expect(repaired).not.toContain("After classifying each processed item");
  });

  it("rewrites the retired start-builder-for-item name", () => {
    const repaired = repairSlackFeedbackPrompt(
      "Call start-builder-for-item; that action pings Builder.",
    );

    expect(repaired).toContain("dispatch-factory-item");
    expect(repaired).not.toContain("start-builder-for-item");
  });
});
