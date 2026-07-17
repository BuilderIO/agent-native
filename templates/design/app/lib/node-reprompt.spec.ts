import { appendAgentChatContextToMessage } from "@agent-native/core/client";
import { isNodeRewriteProposal } from "@shared/node-rewrite";
import { describe, expect, it } from "vitest";

import {
  formatNodeRepromptSubmission,
  formatNodeSelectionQuestion,
  inferNodeRepromptSendMode,
} from "./node-reprompt";

describe("formatNodeRepromptSubmission", () => {
  it("keeps protocol metadata hidden while displaying only the instruction", () => {
    const submission = formatNodeRepromptSubmission({
      repromptId: "reprompt-1",
      designId: "design-1",
      fileId: "file-1",
      target: { nodeId: "hero", selector: '[data-node-id="hero"]' },
      baseVersionHash: "123:abc",
      instruction: "  Give this a better background  ",
      subtreeHtml: '<section data-node-id="hero">Hero</section>',
    });

    expect(submission.message).toBe("Give this a better background");
    expect(submission.message).not.toContain("repromptId");
    expect(submission.context).toContain("[Reprompt selection]");
    expect(submission.context).toContain("repromptId: reprompt-1");
    expect(submission.context).toContain("baseVersionHash: 123:abc");

    const transported = appendAgentChatContextToMessage(
      submission.message,
      submission.context,
    );
    expect(transported).toMatch(/^Give this a better background\n\n<context>/);
    expect(transported).toContain("[Reprompt selection]");
  });
});

describe("inferNodeRepromptSendMode", () => {
  it.each([
    "Make the background darker",
    "Please replace this headline",
    "Could you tighten the spacing?",
    "Give this a better background",
  ])("routes an explicit edit to preview: %s", (instruction) => {
    expect(
      inferNodeRepromptSendMode(instruction, { hasEditableTarget: true }),
    ).toBe("preview");
  });

  it.each([
    "Why does this layout feel unbalanced?",
    "What would you change here?",
    "Give me feedback on this",
    "Does this hierarchy work?",
    "Something about this feels off",
  ])("routes a question or ambiguous prompt to chat: %s", (instruction) => {
    expect(
      inferNodeRepromptSendMode(instruction, { hasEditableTarget: true }),
    ).toBe("ask");
  });

  it("does not offer preview behavior without an editable target", () => {
    expect(
      inferNodeRepromptSendMode("Make this darker", {
        hasEditableTarget: false,
      }),
    ).toBe("ask");
  });
});

describe("formatNodeSelectionQuestion", () => {
  it("keeps selection metadata hidden behind a clean visible question", () => {
    const submission = formatNodeSelectionQuestion({
      designId: "design-1",
      fileId: "file-1",
      target: { nodeId: "hero" },
      instruction: "Why does this feel unbalanced?",
      subtreeHtml: "<section>Hero</section>",
    });

    expect(submission.message).toBe("Why does this feel unbalanced?");
    expect(submission.context).toContain("[Selection question]");
    expect(submission.context).toContain("targetNodeId: hero");
  });
});

describe("isNodeRewriteProposal", () => {
  it("accepts persisted candidate state and rejects incomplete values", () => {
    expect(
      isNodeRewriteProposal({
        proposalId: "proposal-1",
        repromptId: "reprompt-1",
        designId: "design-1",
        fileId: "file-1",
        baseVersionHash: "1:abc",
        target: { nodeId: "hero" },
        resolvedTarget: { nodeId: "hero", selector: "#hero" },
        variants: [{ html: "<section />", summary: "Option" }],
      }),
    ).toBe(true);
    expect(isNodeRewriteProposal({ proposalId: "proposal-1" })).toBe(false);
  });
});
