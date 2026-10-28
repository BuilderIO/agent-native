import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { describe, it, expect } from "vitest";

import {
  buildContentSelectionPayload,
  captureBlockContext,
  SELECTION_TEXT_LIMIT,
} from "./content-selection";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 1 } },
    },
    paragraph: { group: "block", content: "text*" },
    registryBlock: {
      group: "block",
      atom: true,
      attrs: {
        blockType: { default: null },
        blockId: { default: null },
        __raw: { default: null },
      },
    },
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

describe("a selected block", () => {
  function docWithClip(raw: string) {
    return schema.node("doc", null, [
      schema.node("heading", null, schema.text("Demo")),
      schema.node("registryBlock", {
        blockType: "clip-embed",
        blockId: "clip-embed-1a2b3c4d",
        __raw: raw,
      }),
      schema.node("paragraph", null, schema.text("After")),
    ]);
  }

  function clipRange(doc: PMNode) {
    let range: { from: number; to: number } | null = null;
    doc.descendants((node, pos) => {
      if (node.type.name === "registryBlock") {
        range = { from: pos, to: pos + node.nodeSize };
      }
    });
    return range!;
  }

  it("names a selected Clip block and the recording it plays", () => {
    const doc = docWithClip(
      '<ClipEmbed id="clip-embed-old" recordingId="rec_1" origin="link" />',
    );
    const { from, to } = clipRange(doc);
    const payload = buildContentSelectionPayload(doc, "doc1", from, to);
    expect(payload).toMatchObject({
      documentId: "doc1",
      collapsed: false,
      selectedBlock: {
        blockType: "clip-embed",
        blockId: "clip-embed-1a2b3c4d",
        recordingId: "rec_1",
      },
      heading: "Demo",
    });
    expect(payload.selectedText).toBeUndefined();
  });

  it("leaves out a recording id it can't read", () => {
    const doc = docWithClip("<ClipEmbed />");
    const { from, to } = clipRange(doc);
    const payload = buildContentSelectionPayload(doc, "doc1", from, to);
    expect(payload.selectedBlock).toEqual({
      blockType: "clip-embed",
      blockId: "clip-embed-1a2b3c4d",
    });
  });

  it("doesn't call a text selection that runs over a block a selected block", () => {
    const doc = docWithClip(
      '<ClipEmbed id="x" recordingId="rec_1" origin="link" />',
    );
    const payload = buildContentSelectionPayload(
      doc,
      "doc1",
      1,
      doc.content.size - 1,
    );
    expect(payload.selectedBlock).toBeUndefined();
  });
});
