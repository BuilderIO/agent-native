import { describe, expect, it } from "vitest";
import { shouldConvertPasteToAttachment } from "./pasted-text.js";

describe("shouldConvertPasteToAttachment", () => {
  it("keeps a paragraph or two inline", () => {
    const twoParagraphs = [
      "This is a normal paragraph pasted into the composer. ".repeat(16),
      "This is a second paragraph with enough words to feel real, but it is nowhere near a page of text. ".repeat(
        10,
      ),
    ].join("\n\n");

    expect(shouldConvertPasteToAttachment(twoParagraphs)).toBe(false);
  });

  it("keeps a basic bulleted list inline", () => {
    const list = [
      "- Confirm project scope",
      "- Review current designs",
      "- Check the edge cases",
      "- Share implementation notes",
      "- Follow up with QA",
      "- Update release notes",
      "- Coordinate rollout",
      "- Watch for support reports",
    ].join("\n");

    expect(shouldConvertPasteToAttachment(list)).toBe(false);
  });

  it("converts roughly page-sized prose to an attachment", () => {
    const pageOfText =
      "This is source material for the agent to review. ".repeat(72);

    expect(shouldConvertPasteToAttachment(pageOfText)).toBe(true);
  });

  it("converts page-length line-oriented text to an attachment", () => {
    const pageOfLines = Array.from(
      { length: 24 },
      (_, index) =>
        `${index + 1}. A full-page outline item with supporting detail.`,
    ).join("\n");

    expect(shouldConvertPasteToAttachment(pageOfLines)).toBe(true);
  });
});
