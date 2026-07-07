// @vitest-environment happy-dom

import {
  applyDocSurgically,
  createSharedEditorExtensions,
  RunId,
} from "@agent-native/core/client/editor";
import type { PlanBlock } from "@shared/plan-content";
import { blocksToProseJSON } from "@shared/plan-doc";
import { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { PlanBlockNode } from "./PlanBlockNode";

/**
 * Surgical-apply behavior in PLAN terms.
 *
 * When single-doc collab is enabled, the plan applies an authoritative external
 * `blocks[]` update by parsing it into a ProseMirror doc built with the LIVE
 * editor's schema and dispatching ONE `tr.replaceWith(from, to, changed)` for
 * the changed top-level run (`applyBlocksSurgically` → `applyDocSurgically`),
 * NOT a whole-document `setContent`. This is what keeps unchanged `planBlock`
 * NodeViews from being torn down (the flushSync storm that kept collab off) and
 * keeps Yjs ops minimal under the Collaboration extension.
 *
 * These tests pin that property directly: an external `blocks[]` update that
 * changes ONE block must leave the OTHER top-level nodes node-identical
 * (asserted via ProseMirror `Node.eq`, which is per-Schema NodeType identity —
 * so the target doc is parsed with the SAME editor's schema, mirroring
 * production's `editor.schema.nodeFromJSON(blocksToProseJSON(blocks))`).
 */

/**
 * A headless editor with the plan's real schema: the shared base extensions plus
 * `RunId` (stable rich-text run ids) and `PlanBlockNode` (the `planBlock` atom
 * that stands in for every structured block). `features.image` is off to match
 * the live plan editor. History is disabled (the plan owns undo) — irrelevant to
 * the surgical diff, but keeps the schema identical to production.
 */
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
  // Seed the doc from blocks the same way the live editor's `setContent` does.
  editor.commands.setContent(blocksToProseJSON(blocks));
  return editor;
}

/** Parse a `blocks[]` list into a doc bound to THIS editor's schema. */
function parseBlocks(editor: Editor, blocks: PlanBlock[]): ProseMirrorNode {
  return editor.schema.nodeFromJSON(blocksToProseJSON(blocks));
}

/**
 * The top-level `planBlock` atom index for a structured block id, so the test
 * can point at the exact node it expects to change / stay identical.
 */
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
      // The structured atoms live at fixed top-level slots; the surrounding prose
      // occupies the rest. Capture references to the two structured atoms + the
      // outro prose node so we can assert they survive the surgical apply.
      const calloutIndex = planBlockIndexById(before, "callout-1");
      const diagramIndex = planBlockIndexById(before, "diagram-1");
      expect(calloutIndex).toBeGreaterThanOrEqual(0);
      expect(diagramIndex).toBeGreaterThanOrEqual(0);
      const calloutNodeBefore = before.child(calloutIndex);
      const diagramNodeBefore = before.child(diagramIndex);

      // External update: ONLY the diagram block's title changes (its data lives
      // in blocks[], not the doc — but `blocksToProseJSON` stamps `title` into
      // the planBlock node attrs, so this is a real doc-level change to that ONE
      // atom).
      const nextBlocks: PlanBlock[] = blocks.map((block) =>
        block.id === "diagram-1"
          ? ({ ...block, title: "Renamed diagram" } as PlanBlock)
          : block,
      );
      const target = parseBlocks(editor, nextBlocks);

      const result = applyDocSurgically(editor, target);
      expect(result).toBe("applied");

      // Converged to exactly the target doc a full setContent would produce.
      expect(editor.state.doc.eq(target)).toBe(true);

      const after = editor.state.doc;
      // The diagram atom DID change (title attr), so it is a fresh node.
      const diagramNodeAfter = after.child(
        planBlockIndexById(after, "diagram-1"),
      );
      expect(diagramNodeAfter.eq(diagramNodeBefore)).toBe(false);

      // The UNCHANGED callout atom keeps its identity — no NodeView teardown.
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

      // Change only the FIRST rich-text block's prose.
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

      // The structured wireframe atom is untouched → node-identical, so its
      // ReactNodeView is never torn down (no flushSync churn).
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
      // The editor already holds this exact content → the diff is empty.
      const result = applyDocSurgically(editor, target);
      expect(result).toBe("noop");
      // Same doc object identity: no transaction dispatched.
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
      // A doc built from a DIFFERENT editor instance carries a foreign schema;
      // NodeType identity is per-Schema, so `applyDocSurgically` must refuse it
      // rather than corrupt the doc. This is the safety net behind the plan's
      // `applyBlocksSurgically` fallback to the whole-document `setContent`.
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
