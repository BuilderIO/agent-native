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

  it("replaces unconditional robot_face dispatch with a claimed-parent skip", () => {
    const existing = `# Factory Slack feedback triage

For each item, call dispatch-factory-item with clearBug true or false,
productUxImplications false unless it is a pure product or design decision
with no single correct fix, a short reason, and reaction robot_face 🤖.
Cluster only items listed in this run: one dispatch with relatedItemIds. Do
not dispatch needs_manual items or items that already started.
`;

    const repaired = repairSlackFeedbackPrompt(existing);

    expect(repaired).toContain("already has eyes 👀 or robot_face 🤖");
    expect(repaired).toContain("alreadyClaimed true");
    expect(repaired).toContain("clearBug may be omitted");
    expect(repaired).toContain("omit reaction");
    expect(repaired).toContain("neither eyes nor robot_face");
    expect(repaired).toContain("Cluster only items listed in this run");
    expect(repaired).not.toContain(
      "a short reason, and reaction robot_face 🤖.",
    );
    expect(repaired).not.toContain(
      "call dispatch-factory-item with clearBug false, omit reaction",
    );
  });

  it("repairs the intermediate claimed skip that used clearBug false", () => {
    const existing = `# Factory Slack feedback triage

Look at the parent message reactions from get-slack-feedback-context. If the
parent already has eyes 👀 or robot_face 🤖, it has already been looked at:
call dispatch-factory-item with clearBug false, omit reaction, and a short
reason that names the existing marker. Do not start Builder work on it.

For every other item, call dispatch-factory-item with clearBug true or false,
productUxImplications false unless it is a pure product or design decision
with no single correct fix, and a short reason. Pass reaction robot_face 🤖
only when clearBug is true and the parent has neither eyes nor robot_face.
Omit reaction on skips.
`;

    const repaired = repairSlackFeedbackPrompt(existing);

    expect(repaired).toContain("alreadyClaimed true");
    expect(repaired).toContain("clearBug may be omitted");
    expect(repaired).not.toContain(
      "call dispatch-factory-item with clearBug false, omit reaction",
    );
  });

  it("repairs the claimed skip that omitted the clearBug note", () => {
    const existing = `# Factory Slack feedback triage

Look at the parent message reactions from get-slack-feedback-context. If the
parent already has eyes 👀 or robot_face 🤖, it has already been looked at:
call dispatch-factory-item with alreadyClaimed true, omit reaction, and a short
reason that names the existing marker. Do not start Builder work on it.

For every other item, call dispatch-factory-item with clearBug true or false,
productUxImplications false unless it is a pure product or design decision
with no single correct fix, and a short reason. Pass reaction robot_face 🤖
only when clearBug is true and the parent has neither eyes nor robot_face.
Omit reaction on skips.
`;

    const repaired = repairSlackFeedbackPrompt(existing);

    expect(repaired).toContain("alreadyClaimed true (clearBug may be omitted");
    expect(repaired).not.toContain(
      "call dispatch-factory-item with alreadyClaimed true, omit reaction",
    );
  });
});
