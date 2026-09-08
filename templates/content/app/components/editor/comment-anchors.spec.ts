import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { describe, it, expect } from "vitest";

import { captureAnchor, resolveAnchor, buildDocText } from "./comment-anchors";

// Minimal doc/paragraph/text schema — enough to exercise the text-space anchor
// math without pulling in the full editor.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
  marks: {},
});

function mkDoc(paragraphs: string[]): PMNode {
  return schema.node(
    "doc",
    null,
    paragraphs.map((p) =>
      schema.node("paragraph", null, p ? schema.text(p) : undefined),
    ),
  );
}

describe("comment-anchors", () => {
  it("captures and resolves a selection round-trip", () => {
    const doc = mkDoc(["Hello world foo"]);
    // "world" sits at char index 6 → ProseMirror pos 7 (pos 0 precedes the
    // paragraph, pos 1 is the first char).
    const from = 7;
    const to = 12;
    expect(doc.textBetween(from, to)).toBe("world");

    const anchor = captureAnchor(doc, from, to);
    expect(anchor.quotedText).toBe("world");
    expect(anchor.prefix).toBe("Hello ");
    expect(anchor.suffix).toBe(" foo");

    const range = resolveAnchor(doc, anchor);
    expect(range).toEqual({ from, to });
  });

  it("disambiguates a repeated quote using surrounding context", () => {
    const doc = mkDoc([
      "The quick brown fox jumps over the lazy dog.",
      "The second paragraph: the lazy dog appears again here.",
    ]);
    const { text } = buildDocText(doc);
    const secondOccurrence = text.indexOf(
      "the lazy dog",
      text.indexOf("the lazy dog") + 1,
    );
    expect(secondOccurrence).toBeGreaterThan(-1);

    // Anchor whose context matches the SECOND occurrence.
    const range = resolveAnchor(doc, {
      quotedText: "the lazy dog",
      prefix: "paragraph: ",
      suffix: " appears again",
      startOffset: secondOccurrence,
    });
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe("the lazy dog");
    // The resolved range must land in the second paragraph, not the first.
    const firstParaEnd = "The quick brown fox jumps over the lazy dog.".length;
    expect(range!.from).toBeGreaterThan(firstParaEnd);
  });

  it("falls back to the first occurrence for a quote-only anchor", () => {
    const doc = mkDoc(["alpha beta alpha beta"]);
    const range = resolveAnchor(doc, { quotedText: "alpha" });
    expect(range).toEqual({ from: 1, to: 6 });
  });

  it("returns null for an orphaned quote that no longer exists", () => {
    const doc = mkDoc(["Nothing to see here."]);
    expect(resolveAnchor(doc, { quotedText: "missing phrase" })).toBeNull();
    expect(resolveAnchor(doc, { quotedText: null })).toBeNull();
  });

  it("re-resolves against an edited document", () => {
    const original = mkDoc(["Intro. The target phrase lives here."]);
    const anchor = captureAnchor(original, 8, 25);
    expect(anchor.quotedText).toBe("The target phrase");

    // Text inserted before the quote shifts every position; resolution by
    // content still finds it (this is what survives the markdown round-trip).
    const edited = mkDoc([
      "A much longer intro was prepended. The target phrase lives here.",
    ]);
    const range = resolveAnchor(edited, anchor);
    expect(range).not.toBeNull();
    expect(edited.textBetween(range!.from, range!.to)).toBe(
      "The target phrase",
    );
  });

  it("handles a quote that spans multiple text nodes in order", () => {
    // Two paragraphs; a quote within the first should not bleed into the second.
    const doc = mkDoc(["first block here", "second block here"]);
    const range = resolveAnchor(doc, { quotedText: "block here" });
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe("block here");
    // First occurrence is in paragraph one.
    expect(range!.from).toBeLessThan("first block here".length + 2);
  });
});
