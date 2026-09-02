import { describe, expect, it } from "vitest";

import { getEmbeddedFrameDocumentContent } from "./embedded-frame";

/**
 * A screen document with no height rule ends where its content ends, so the
 * screen's fill and any border stop short of the frame's edge while the frame
 * itself keeps the board's size.
 */
describe("getEmbeddedFrameDocumentContent fitBodyToFrame", () => {
  const doc = (head = "") =>
    `<!DOCTYPE html><html><head>${head}</head><body><div>x</div></body></html>`;

  it("makes the document track the frame", () => {
    const html = getEmbeddedFrameDocumentContent({
      content: doc(),
      fitBodyToFrame: true,
    });
    expect(html).toContain("data-agent-native-frame-fit");
    expect(html).toContain("html{height:100%}");
    expect(html).toContain("body{min-height:100%}");
  });

  it("uses min-height so content taller than the frame still grows", () => {
    const html = getEmbeddedFrameDocumentContent({
      content: doc(),
      fitBodyToFrame: true,
    });
    expect(html).not.toContain("body{height:100%}");
  });

  it("does not force the rule, so a document setting its own height wins", () => {
    const html = getEmbeddedFrameDocumentContent({
      content: doc(),
      fitBodyToFrame: true,
    });
    const fit = /<style data-agent-native-frame-fit>(.*?)<\/style>/.exec(html);
    expect(fit?.[1]).not.toContain("!important");
  });

  it("leaves board surfaces alone — they position their own content", () => {
    const html = getEmbeddedFrameDocumentContent({ content: doc() });
    expect(html).not.toContain("data-agent-native-frame-fit");
  });
});
