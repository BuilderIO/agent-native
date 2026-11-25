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
    codeBlock: {
      group: "block",
      content: "text*",
      attrs: { language: { default: null }, identityId: { default: null } },
    },
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

describe("a selected interactive HTML block", () => {
  const code = (language: string, text: string, identityId?: string) =>
    schema.node("codeBlock", { language, identityId }, schema.text(text));
  const doc = schema.node("doc", null, [
    schema.node("heading", null, schema.text("Demo")),
    code("html interactive", "<title>First</title>"),
    code("html", "<title>Plain</title>"),
    code("html interactive", "<title>Second</title>", "block_second"),
  ]);
  const second = doc.content.size - doc.child(3).nodeSize;

  it("is named with its place among the page's blocks and its ID", () => {
    expect(
      buildContentSelectionPayload(doc, "doc1", second, doc.content.size),
    ).toEqual({
      documentId: "doc1",
      collapsed: false,
      interactiveBlock: {
        title: "Second",
        blockId: "block_second",
        number: 2,
        whole: true,
      },
      blockText: "",
      heading: "Demo",
    });
  });

  it("is named where its source is being edited", () => {
    const { from, to } = findTextRange(doc, "First");

    expect(buildContentSelectionPayload(doc, "doc1", from, to)).toMatchObject({
      selectedText: "First",
      interactiveBlock: { title: "First", number: 1, whole: false },
    });
    expect(buildContentSelectionPayload(doc, "doc1", to, to)).toMatchObject({
      collapsed: true,
      interactiveBlock: { title: "First", number: 1, whole: false },
    });
  });

  it("isn't named for other code, or a selection that runs past it", () => {
    const plain = findTextRange(doc, "Plain");

    for (const { from, to } of [plain, { from: 1, to: doc.content.size }]) {
      expect(
        buildContentSelectionPayload(doc, "doc1", from, to).interactiveBlock,
      ).toBeUndefined();
    }
  });
});
