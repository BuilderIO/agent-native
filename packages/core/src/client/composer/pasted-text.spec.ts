import { describe, expect, it } from "vitest";
import {
  createPastedAttachmentFile,
  isPastedTextAttachmentName,
  readClipboardPaste,
  shouldConvertClipboardToAttachment,
  shouldConvertPasteToAttachment,
  unwrapAttachmentEnvelope,
  type ClipboardPaste,
} from "./pasted-text.js";

function clipboard(flavors: Record<string, string>): {
  getData(type: string): string;
} {
  return { getData: (type: string) => flavors[type] ?? "" };
}

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

  it("unwraps assistant-ui text attachment envelopes with attributes", () => {
    expect(
      unwrapAttachmentEnvelope(
        '<attachment name="notes.txt" contentType="text/plain">\nLine one\nLine two\n</attachment>',
      ),
    ).toBe("Line one\nLine two");
  });
});

describe("readClipboardPaste", () => {
  it("returns both flavors when present", () => {
    const paste = readClipboardPaste(
      clipboard({ "text/plain": "hello", "text/html": "<p>hello</p>" }),
    );
    expect(paste.text).toBe("hello");
    expect(paste.html).toBe("<p>hello</p>");
  });

  it("omits an empty html flavor", () => {
    const paste = readClipboardPaste(
      clipboard({ "text/plain": "hello", "text/html": "   " }),
    );
    expect(paste.html).toBeUndefined();
  });

  it("tolerates a missing DataTransfer", () => {
    const paste = readClipboardPaste(null);
    expect(paste.text).toBe("");
    expect(paste.html).toBeUndefined();
  });
});

const pageOfHtml = `<!doctype html>\n<html><body>${"<div>Product narrative section.</div>\n".repeat(
  80,
)}</body></html>`;

describe("createPastedAttachmentFile", () => {
  it("stores pasted HTML source as a real .html attachment", () => {
    const paste: ClipboardPaste = { text: pageOfHtml };
    const file = createPastedAttachmentFile(paste);
    expect(file.name).toMatch(/^pasted-text-.*\.html$/);
    expect(file.type).toBe("text/html");
    expect(isPastedTextAttachmentName(file.name)).toBe(true);
  });

  it("keeps plain prose as a .txt attachment (no html flavor)", () => {
    const file = createPastedAttachmentFile({
      text: "This is just a long block of plain prose. ".repeat(80),
    });
    expect(file.name).toMatch(/^pasted-text-.*\.txt$/);
    expect(file.type).toBe("text/plain");
  });

  it("does NOT promote code to html just because text/html carries highlight markup", () => {
    // VS Code / editors put syntax-highlight <span> markup in text/html even
    // though the real content (text/plain) is plain code. Keep it as .txt.
    const code = "const x: number = 1;\n".repeat(200);
    const highlightHtml = `<div style="color:#abb2bf">${"<span>const</span> <span>x</span>\n".repeat(
      200,
    )}</div>`;
    const file = createPastedAttachmentFile({
      text: code,
      html: highlightHtml,
    });
    expect(file.name).toMatch(/\.txt$/);
    expect(file.type).toBe("text/plain");
  });

  it("falls back to the html flavor when there is no usable plain text", () => {
    const file = createPastedAttachmentFile({ text: "   ", html: pageOfHtml });
    expect(file.name).toMatch(/\.html$/);
    expect(file.type).toBe("text/html");
  });

  it("preserves the markup verbatim in the file body", async () => {
    const file = createPastedAttachmentFile({ text: pageOfHtml });
    expect(await file.text()).toBe(pageOfHtml);
  });
});

describe("shouldConvertClipboardToAttachment", () => {
  it("converts a page-sized HTML source paste", () => {
    expect(shouldConvertClipboardToAttachment({ text: pageOfHtml })).toBe(true);
  });

  it("converts an html-only paste with an empty plain flavor", () => {
    expect(
      shouldConvertClipboardToAttachment({ text: "", html: pageOfHtml }),
    ).toBe(true);
  });

  it("keeps a short paste inline even if it carries rich html", () => {
    expect(
      shouldConvertClipboardToAttachment({
        text: "two words",
        html: "<b>two</b> <i>words</i>",
      }),
    ).toBe(false);
  });
});
