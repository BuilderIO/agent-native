// @vitest-environment happy-dom

import {
  applyDocSurgically,
  createSharedEditorExtensions,
  RunId,
} from "@agent-native/toolkit/editor";
import type { PlanBlock } from "@shared/plan-content";
import { blocksToProseJSON } from "@shared/plan-doc";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { PlanBlockNode } from "./PlanBlockNode";


function makePlanEditor(blocks: PlanBlock[]): Editor {
  const editor = new Editor({
    extensions: createSharedEditorExtensions({
      dialect: "gfm",
      preset: "plan",
      features: { image: false },
      extraExtensions: [RunId, PlanBlockNode],
      disableHistory: true,
    }),
    content: "",
  });
  editor.commands.setContent(blocksToProseJSON(blocks));
  return editor;
}

function parseBlocks(editor: Editor, blocks: PlanBlock[]): ProseMirrorNode {
  return editor.schema.nodeFromJSON(blocksToProseJSON(blocks));
}

function planBlockIndexById(doc: ProseMirrorNode, blockId: string): number {
  let index = -1;
  doc.forEach((child, _offset, i) => {
    if (
      child.type.name === "planBlock" &&
      (child.attrs as { blockId?: unknown }).blockId === blockId
    ) {
      index = i;
    }
  });
  return index;
}

describe("PlanDocumentEditor surgical apply (blocks[] → doc)", () => {
  it("changing ONE structured block does not recreate the other top-level nodes", () => {
    const blocks: PlanBlock[] = [
      { id: "rt-intro", type: "rich-text", data: { markdown: "Intro copy." } },
      {
        id: "callout-1",
        type: "callout",
        data: { tone: "info", body: "First note." },
      },
      {
        id: "diagram-1",
        type: "diagram",
        data: { nodes: [{ id: "n1", label: "Start" }], edges: [] },
      },
      { id: "rt-outro", type: "rich-text", data: { markdown: "Outro copy." } },
    ];
    const editor = makePlanEditor(blocks);
    try {
      const before = editor.state.doc;
      const calloutIndex = planBlockIndexById(before, "callout-1");
      const diagramIndex = planBlockIndexById(before, "diagram-1");
      expect(calloutIndex).toBeGreaterThanOrEqual(0);
      expect(diagramIndex).toBeGreaterThanOrEqual(0);
      const calloutNodeBefore = before.child(calloutIndex);
      const diagramNodeBefore = before.child(diagramIndex);

      const nextBlocks: PlanBlock[] = blocks.map((block) =>
        block.id === "diagram-1"
          ? ({ ...block, title: "Renamed diagram" } as PlanBlock)
          : block,
      );
      const target = parseBlocks(editor, nextBlocks);

      const result = applyDocSurgically(editor, target);
      expect(result).toBe("applied");

      expect(editor.state.doc.eq(target)).toBe(true);

      const after = editor.state.doc;
      const diagramNodeAfter = after.child(
        planBlockIndexById(after, "diagram-1"),
      );
      expect(diagramNodeAfter.eq(diagramNodeBefore)).toBe(false);

      const calloutNodeAfter = after.child(
        planBlockIndexById(after, "callout-1"),
      );
      expect(calloutNodeAfter.eq(calloutNodeBefore)).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("editing one rich-text block leaves the untouched structured atom identical", () => {
    const blocks: PlanBlock[] = [
      {
        id: "rt-a",
        type: "rich-text",
        data: { markdown: "Before the block." },
      },
      {
        id: "wireframe-1",
        type: "wireframe",
        data: {
          surface: "desktop",
          caption: "Home",
          screen: [{ id: "t1", el: "title", text: "Welcome" }],
        },
      },
      { id: "rt-b", type: "rich-text", data: { markdown: "After the block." } },
    ];
    const editor = makePlanEditor(blocks);
    try {
      const before = editor.state.doc;
      const wireframeIndex = planBlockIndexById(before, "wireframe-1");
      expect(wireframeIndex).toBeGreaterThanOrEqual(0);
      const wireframeNodeBefore = before.child(wireframeIndex);

      const nextBlocks: PlanBlock[] = blocks.map((block) =>
        block.id === "rt-a"
          ? ({
              ...block,
              data: { markdown: "Before the block, edited." },
            } as PlanBlock)
          : block,
      );
      const target = parseBlocks(editor, nextBlocks);

      const result = applyDocSurgically(editor, target);
      expect(result).toBe("applied");
      expect(editor.state.doc.eq(target)).toBe(true);

      const after = editor.state.doc;
      const wireframeNodeAfter = after.child(
        planBlockIndexById(after, "wireframe-1"),
      );
      expect(wireframeNodeAfter.eq(wireframeNodeBefore)).toBe(true);
    } finally {
      editor.destroy();
    }
  });

  it("an identical external blocks[] update is a no-op (nothing re-applied)", () => {
    const blocks: PlanBlock[] = [
      { id: "rt-x", type: "rich-text", data: { markdown: "Stable copy." } },
      {
        id: "callout-x",
        type: "callout",
        data: { tone: "warning", body: "Careful." },
      },
    ];
    const editor = makePlanEditor(blocks);
    try {
      const before = editor.state.doc;
      const target = parseBlocks(editor, blocks);
      const result = applyDocSurgically(editor, target);
      expect(result).toBe("noop");
      expect(editor.state.doc).toBe(before);
    } finally {
      editor.destroy();
    }
  });

  it("a foreign-schema doc fails surgical apply (caller falls back to setContent)", () => {
    const blocks: PlanBlock[] = [
      { id: "rt-1", type: "rich-text", data: { markdown: "Body." } },
    ];
    const editor = makePlanEditor(blocks);
    const other = makePlanEditor(blocks);
    try {
      const foreign = other.schema.nodeFromJSON(
        blocksToProseJSON([
          { id: "rt-1", type: "rich-text", data: { markdown: "Changed." } },
        ]),
      );
      expect(applyDocSurgically(editor, foreign)).toBe("failed");
    } finally {
      editor.destroy();
      other.destroy();
    }
  });
});
