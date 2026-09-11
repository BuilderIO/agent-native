import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { describe, it, expect } from "vitest";

import {
  buildContentSelectionPayload,
  captureBlockContext,
  SELECTION_TEXT_LIMIT,
} from "./content-selection";

// Minimal doc/heading/paragraph/text schema — enough to exercise the block and
// heading lookups without pulling in the full editor.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 1 } },
    },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
  marks: {},
});

function mkDoc(
  blocks: Array<{ type: "heading" | "paragraph"; text: string }>,
): PMNode {
  return schema.node(
    "doc",
    null,
    blocks.map((b) =>
      schema.node(b.type, null, b.text ? schema.text(b.text) : undefined),
    ),
  );
}

/** Locate a text node's ProseMirror range by its content, so tests don't have
 *  to hand-compute open/close token offsets across sibling blocks. */
function findTextRange(
  doc: PMNode,
  needle: string,
): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText || typeof node.text !== "string") return !found;
    const idx = node.text.indexOf(needle);
    if (idx === -1) return true;
    found = { from: pos + idx, to: pos + idx + needle.length };
    return false;
  });
  if (!found) throw new Error(`text not found in doc: ${needle}`);
  return found;
}

describe("captureBlockContext", () => {
  it("finds the containing paragraph and nearest preceding heading", () => {
    const doc = mkDoc([
      { type: "heading", text: "Section One" },
      { type: "paragraph", text: "Hello world foo" },
    ]);
    // Position inside the paragraph's text ("world").
    const pos = doc.content.size - 5;
    const { blockText, heading } = captureBlockContext(doc, pos);
    expect(blockText).toBe("Hello world foo");
    expect(heading).toBe("Section One");
  });

  it("returns a null heading when none precedes the position", () => {
    const doc = mkDoc([{ type: "paragraph", text: "No heading here" }]);
    const { heading } = captureBlockContext(doc, 3);
    expect(heading).toBeNull();
  });
});

describe("buildContentSelectionPayload", () => {
  it("marks a cursor-only selection as collapsed with no selected text", () => {
    const doc = mkDoc([
      { type: "heading", text: "Intro" },
      { type: "paragraph", text: "Some body text" },
    ]);
    const pos = doc.content.size - 4;
    const payload = buildContentSelectionPayload(doc, "doc1", pos, pos);
    expect(payload.collapsed).toBe(true);
    expect(payload.selectedText).toBeUndefined();
    expect(payload.heading).toBe("Intro");
  });

  it("captures the selected text and anchor for a real selection", () => {
    const doc = mkDoc([
      { type: "heading", text: "Intro" },
      { type: "paragraph", text: "Hello world foo" },
    ]);
    const { from, to } = findTextRange(doc, "world");
    expect(doc.textBetween(from, to)).toBe("world");

    const payload = buildContentSelectionPayload(doc, "doc1", from, to);
    expect(payload.collapsed).toBe(false);
    expect(payload.selectedText).toBe("world");
    expect(payload.textTruncated).toBe(false);
    // captureAnchor flattens text across block boundaries (see
    // comment-anchors.ts), so the prefix can include the prior block's text.
    expect(payload.prefix).toBe("IntroHello ");
    expect(payload.suffix).toBe(" foo");
    expect(payload.heading).toBe("Intro");
    expect(payload.blockText).toBe("Hello world foo");
    expect(payload.documentId).toBe("doc1");
  });

  it("truncates and flags a selection longer than the cap", () => {
    const longText = "x".repeat(SELECTION_TEXT_LIMIT + 50);
    const doc = mkDoc([{ type: "paragraph", text: longText }]);
    const from = 1;
    const to = doc.content.size - 1;
    const payload = buildContentSelectionPayload(doc, "doc1", from, to);
    expect(payload.textTruncated).toBe(true);
    expect(payload.selectedText).toHaveLength(SELECTION_TEXT_LIMIT);
  });
});
